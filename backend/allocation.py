"""Allocation planner - the optimisation core of MedFlow.

Problem (one planning epoch, time `now`, horizon H):
    choose for every waiting patient p a start time s_p and a resource bundle
    (1 bed, 1 doctor, k nurses, equipment units)  that

    MINIMISE  J = alpha*sum(wait) + beta*sum(m_p*(wait_p/target_p)^2) + gamma*idle
                  + delta*travel + epsilon*unserved + zeta*reassignments
    SUBJECT TO (hard constraints - never traded off against J):
        (H1) capacity / no double booking: every resource is used by at most one
             patient at any time  (interval calendars, current commitments included)
        (H2) bed compatibility (ICU-level patients only in ICU beds, OR only in theatres, ...)
        (H3) doctor holds the required specialty skill
        (H4) each nurse holds ALL required skills and covers the bed's zone (department constraint)
        (H5) staff are on shift and operational for the assignment; failed resources are excluded
        (H6) required equipment units are free

Method: *priority-ordered serial schedule generation with backfilling* (a standard
RCPSP heuristic).  Patients are visited in descending priority S_p; each takes the
earliest start time at which a feasible bundle exists, and books it on the
resource calendars, so lower-priority patients can only use gaps that do not delay
higher-priority reservations.  Among feasible bundles the cheapest (travel,
scarce-skill use, workload, continuity) is chosen.  A local search over adjacent
swaps of the priority order then minimises J.  Because every plan is built from
calendars that already contain the hard constraints, an infeasible plan cannot be
produced; if no bundle exists the patient is reported as *unscheduled* with the
conflict that blocks them.

This is a constructive heuristic + local search, not a proven-optimal MILP.
"""
from __future__ import annotations
import math
from dataclasses import dataclass, field, asdict
from .hospital import DIST, MAXDIST_TO, BED_COMPAT, BED_RANK, DEPT_ZONE
from .config import urgency_category
from . import priority as prio

INF = 10 ** 9


@dataclass
class PlanItem:
    patient_id: str
    dispatch_time: int
    start_time: int
    end_time: int
    bed_id: str
    doctor_id: str
    nurse_ids: list
    equipment_ids: list
    travel: float
    cost: float
    role_ready: dict
    binding: str
    duration: int
    score: float

    def to_dict(self):
        return asdict(self)


@dataclass
class Plan:
    time: int
    mode: str
    strategy: str
    items: list = field(default_factory=list)
    unscheduled: list = field(default_factory=list)
    scores: dict = field(default_factory=dict)
    J: dict = field(default_factory=dict)
    order: list = field(default_factory=list)
    conflicts: list = field(default_factory=list)
    evaluations: int = 0

    def immediate(self):
        return sorted([i for i in self.items if i.dispatch_time <= self.time], key=lambda i: (i.dispatch_time, i.patient_id))

    def by_patient(self):
        return {i.patient_id: i for i in self.items}

    def to_dict(self):
        return dict(time=self.time, mode=self.mode, strategy=self.strategy, order=self.order, J=self.J,
                    items=[i.to_dict() for i in self.items], unscheduled=self.unscheduled,
                    scores=self.scores, conflicts=self.conflicts, evaluations=self.evaluations)


class Cal:
    """Booked intervals per resource:  rid -> [(start, end, zone)]."""
    __slots__ = ("book",)

    def __init__(self, book=None):
        self.book = book if book is not None else {}

    def copy(self):
        return Cal({k: list(v) for k, v in self.book.items()})

    def free(self, rid, s, e):
        for a, b, _ in self.book.get(rid, ()):
            if a < e and b > s:
                return False
        return True

    def add(self, rid, s, e, zone):
        self.book.setdefault(rid, []).append((s, e, zone))

    def loc_at(self, rid, s, default):
        best, zone = -1, default
        for a, b, z in self.book.get(rid, ()):
            if b <= s and b > best:
                best, zone = b, z
        return zone


class _Ctx:
    __slots__ = ("beds", "docs", "nurses", "equip", "dur", "clean", "prev", "home", "primary", "tbmax", "zones")


class Planner:
    def __init__(self, hospital, cfg, strategy, predictor, mode="NORMAL", weights=None):
        self.h, self.cfg, self.st, self.pred = hospital, cfg, strategy, predictor
        self.mode = mode if strategy.get("adaptive_emergency") else "NORMAL"
        w = strategy.get("weights")
        self.weights = weights or w or (cfg.weights_emergency if self.mode == "EMERGENCY" else cfg.weights_normal)
        self.now = hospital.now
        self.evals = 0

    # ------------------------------------------------------------ preparation
    def _prepare(self):
        h, cfg, now = self.h, self.cfg, self.now
        self.avail_from, self.avail_until = {}, {}
        self.base = Cal()
        for s in h.all_staff():
            if s.status == "unavailable":
                frm = s.unavailable_until if (s.unavailable_until and s.unavailable_until > now) else INF
            elif s.status == "off_shift":
                frm = s.shift_start if (not s.on_call and s.shift_start > now) else INF
            else:
                frm = now
            until = INF if s.on_call else s.shift_end - cfg.shift_end_buffer
            if s.leaving:
                until = now
            self.avail_from[s.id], self.avail_until[s.id] = frm, until
            if s.busy_until and s.busy_until > now:
                self.base.add(s.id, now, s.busy_until, s.target_zone or s.location)
        for b in h.beds.values():
            if b.status == "unavailable":
                frm = b.unavailable_until if (b.unavailable_until and b.unavailable_until > now) else INF
            elif b.status == "cleaning":
                frm = max(now, b.cleaning_until or now)
            else:
                frm = now
            self.avail_from[b.id], self.avail_until[b.id] = frm, INF
        for u in h.equipment.values():
            self.avail_from[u.id] = INF if u.status == "unavailable" else now
            self.avail_until[u.id] = INF
        for p in h.active():                       # current commitments
            end = max(p.pred_end or now + 1, now + 1)
            bed = h.beds[p.current_bed]
            z = bed.zone
            for sid in ([p.assigned_doctor] + list(p.assigned_nurses)):
                self.base.add(sid, now, end, z)
            self.base.add(bed.id, now, end + self._clean(bed), z)
            for u in p.equipment_units:
                self.base.add(u, now, end, z)
        self.docs_all = sorted(h.doctors.values(), key=lambda d: d.id)
        self.nurses_all = sorted(h.nurses.values(), key=lambda n: n.id)
        self.beds_all = sorted(h.beds.values(), key=lambda b: b.id)
        self.equip_by_kind = {}
        for u in h.equipment.values():
            self.equip_by_kind.setdefault(u.kind, []).append(u)
        for v in self.equip_by_kind.values():
            v.sort(key=lambda u: u.id)
        self.skill_cnt = h.skill_counts()
        self._ctx = {}

    def _clean(self, bed):
        cm = self.cfg.cleaning_minutes
        return cm.get(bed.type, cm["default"])

    def _acceptable_beds(self, p):
        types = list(BED_COMPAT[p.bed_type_required])
        if p.bed_type_required == "emergency" and p.urgency >= 8:
            types = ["emergency"]                       # critical ER patients never board on ward-level beds
        if self.mode == "EMERGENCY" and p.urgency < 6:
            types = types[:1]                           # preserve higher-level capacity for sicker patients
        return types

    def _context(self, p):
        c = self._ctx.get(p.id)
        if c:
            return c
        c = _Ctx()
        types = self._acceptable_beds(p)
        c.primary = types[0]
        c.beds = [b for b in self.beds_all if b.type in types and self.avail_from[b.id] < INF]
        c.docs = [d for d in self.docs_all if p.required_specialty in d.skills and self.avail_from[d.id] < INF]
        need = set(p.required_nurse_skills)
        c.nurses = [n for n in self.nurses_all if need <= set(n.skills) and self.avail_from[n.id] < INF]
        c.equip = {k: [u for u in self.equip_by_kind.get(k, []) if self.avail_from[u.id] < INF] for k in p.equipment_required}
        c.dur = max(3, int(math.ceil(self.pred.new_stint(p))))
        c.clean = {b.id: self._clean(b) for b in c.beds}
        pb = p.planned_bundle or {}
        c.prev = set(([pb["bed"]] if pb.get("bed") else []) + ([pb["doctor"]] if pb.get("doctor") else []) + list(pb.get("nurses", [])))
        c.home = DEPT_ZONE.get(p.department, "HUB")
        c.zones = sorted({b.zone for b in c.beds})
        c.tbmax = max([MAXDIST_TO[b.zone] for b in c.beds], default=0)
        self._ctx[p.id] = c
        return c

    # ------------------------------------------------------------ costs
    def _scarcity(self, st, needed):
        tot = 0.0
        for k in st.skills:
            if k not in needed:
                tot += 1.0 / max(1, self.skill_cnt.get((st.role, k), 1))
        return tot

    def _staff_cost(self, st, p, zone, s, cal, ctx, needed):
        J, B = self.cfg.J, self.cfg.bundle
        loc = cal.loc_at(st.id, s, st.location)
        trav = DIST[loc][zone]
        c = (J["alpha"] + J["delta"]) * trav                     # start delay + movement cost
        c += B["workload"] * (st.workload / max(1.0, self.now + 60))
        c += B["scarcity"] * self._scarcity(st, needed)
        if ctx.prev and st.id not in ctx.prev:
            c += J["zeta"] * 0.5                                 # continuity with the previous plan
        return c, trav

    # ------------------------------------------------------------ bundle search at dispatch time s
    def _try(self, p, s, cal, ctx):
        dur, tbmax, ok = ctx.dur, ctx.tbmax, self._okstaff
        feas = {"bed": False, "doctor": False, "nurse": False, "equipment": True}
        k = p.nurses_required
        docs = [d for d in ctx.docs if ok(d.id, s, s + dur + tbmax, cal)]
        feas["doctor"] = bool(docs)
        eq_pick = {}
        for kind, q in p.equipment_required.items():
            free = [u for u in ctx.equip.get(kind, []) if s >= self.avail_from[u.id] and cal.free(u.id, s, s + dur + tbmax)]
            if len(free) < q:
                feas["equipment"] = False
            else:
                eq_pick[kind] = free[:q]
        nurses_z = {}
        for z in ctx.zones:
            nurses_z[z] = [n for n in ctx.nurses if z in n.covered_zones and ok(n.id, s, s + dur + MAXDIST_TO[z], cal)]
            if len(nurses_z[z]) >= k:
                feas["nurse"] = True
        best = None
        cost_aware = self.st.get("cost_aware", True)
        for b in ctx.beds:
            z = b.zone
            if s < self.avail_from[b.id] or not cal.free(b.id, s, s + dur + MAXDIST_TO[z] + ctx.clean[b.id]):
                continue
            feas["bed"] = True
            nz = nurses_z.get(z, [])
            if not docs or len(nz) < k or not feas["equipment"]:
                continue
            if not cost_aware:
                doc, nurs = docs[0], nz[:k]
                cost = 0.0
                trav_list = [DIST[cal.loc_at(x.id, s, x.location)][z] for x in [doc] + nurs]
                best = (cost, b, doc, nurs, trav_list)
                break
            bed_cost = 0.0
            B = self.cfg.bundle
            if b.type != ctx.primary:
                bed_cost += B["bed_class"] * (1 + abs(BED_RANK[b.type] - BED_RANK[ctx.primary]))
            bed_cost += B["zone_mismatch"] * DIST[ctx.home][z]
            if ctx.prev and b.id not in ctx.prev:
                bed_cost += self.cfg.J["zeta"] * 0.5
            dneed = {p.required_specialty}
            dc = sorted(((self._staff_cost(d, p, z, s, cal, ctx, dneed), d) for d in docs), key=lambda t: (t[0][0], t[1].id))[0]
            nneed = set(p.required_nurse_skills)
            nc = sorted(((self._staff_cost(n, p, z, s, cal, ctx, nneed), n) for n in nz), key=lambda t: (t[0][0], t[1].id))[:k]
            total = bed_cost + dc[0][0] + sum(c[0][0] for c in nc)
            cand = (total, b, dc[1], [c[1] for c in nc], [dc[0][1]] + [c[0][1] for c in nc])
            if best is None or (cand[0], cand[1].id) < (best[0], best[1].id):
                best = cand
        return best, feas, eq_pick

    def _okstaff(self, rid, s, e, cal):
        return self.avail_from[rid] <= s < self.avail_until[rid] and cal.free(rid, s, e)

    # ------------------------------------------------------------ schedule one patient
    def _schedule(self, p, cal, comp):
        now, H = self.now, self.cfg.horizon
        ctx = self._context(p)
        # structural infeasibility: report the exact conflict instead of assigning anything
        why = self._structural(p, ctx)
        if why:
            return None, dict(patient_id=p.id, reason=why, binding=why_binding(p, ctx, self), structural=True)
        times = [now]
        if self.st.get("lookahead", True):
            ts = set()
            rids = [b.id for b in ctx.beds] + [d.id for d in ctx.docs] + [n.id for n in ctx.nurses] + \
                   [u.id for v in ctx.equip.values() for u in v]
            for rid in rids:
                f = self.avail_from[rid]
                if now < f <= now + H:
                    ts.add(f)
                for a, b, _ in cal.book.get(rid, ()):
                    if now < b <= now + H:
                        ts.add(b)
            times += sorted(ts)[:24]
        first = {}
        for s in times:
            best, feas, eq = self._try(p, s, cal, ctx)
            for role, okk in feas.items():
                if okk and role not in first:
                    first[role] = s
            if best:
                cost, b, doc, nurs, travs = best
                z = b.zone
                T = s + int(max(travs))
                end = T + ctx.dur
                cal.add(doc.id, s, end, z)
                for n in nurs:
                    cal.add(n.id, s, end, z)
                cal.add(b.id, s, end + ctx.clean[b.id], z)
                eq_ids = []
                for kind, units in eq.items():
                    for u in units:
                        cal.add(u.id, s, end, z)
                        eq_ids.append(u.id)
                ready = {r: first.get(r, s) for r in ("bed", "doctor", "nurse", "equipment")}
                binding = self._binding_label(p, ready, z, ctx, s)
                item = PlanItem(p.id, s, T, end, b.id, doc.id, [n.id for n in nurs], eq_ids, float(sum(travs)),
                                round(cost, 2), ready, binding, ctx.dur, comp["S"])
                return item, None
        # nothing feasible within horizon
        missing = [r for r in ("bed", "doctor", "nurse", "equipment") if r not in first]
        reason = ("No feasible bundle within the %d-min horizon; blocked on: %s" % (H, ", ".join(missing))) if missing \
            else "No simultaneously-free bundle within the %d-min horizon" % H
        ready = {r: first.get(r, INF) for r in ("bed", "doctor", "nurse", "equipment")}
        binding = self._binding_label(p, ready, ctx.home, ctx, INF)
        return None, dict(patient_id=p.id, reason=reason, binding=binding, structural=False)

    def _structural(self, p, ctx):
        if not ctx.beds:
            return f"No operational bed compatible with '{p.bed_type_required}' requirement exists (all unavailable)"
        if not ctx.docs:
            return f"No qualified doctor (specialty '{p.required_specialty}') is on shift/available"
        zone_ok = [z for z in ctx.zones if sum(1 for n in ctx.nurses if z in n.covered_zones) >= p.nurses_required]
        if not zone_ok:
            return (f"No {p.nurses_required} nurse(s) with skills {p.required_nurse_skills} covering "
                    f"{'/'.join(ctx.zones)} are on shift")
        for kind, q in p.equipment_required.items():
            if len(ctx.equip.get(kind, [])) < q:
                return f"Required equipment '{kind}' x{q} is not operational (available units: {len(ctx.equip.get(kind, []))})"
        return ""

    def _binding_label(self, p, ready, zone, ctx, s):
        role = max(("nurse", "doctor", "bed", "equipment"), key=lambda r: (ready[r], {"nurse": 3, "doctor": 2, "bed": 1, "equipment": 0}[r]))
        if role == "bed":
            return f"bed:{ctx.primary}"
        if role == "doctor":
            return f"doctor:{p.required_specialty}"
        if role == "nurse":
            return f"nurse@{zone}"
        kind = next((k for k in p.equipment_required), "equipment")
        return f"equip:{kind}"

    # ------------------------------------------------------------ build + objective
    def _build(self, order, comps):
        cal = self.base.copy()
        items, unsched = [], []
        for p in order:
            it, why = self._schedule(p, cal, comps[p.id])
            (items.append(it) if it else unsched.append(why))
        self.evals += 1
        return items, unsched, cal

    def objective(self, items, unsched, cal, order):
        cfg, now, H = self.cfg, self.now, self.cfg.horizon
        J = cfg.J
        beta = J["beta"] * (cfg.emergency_beta_mult if self.mode == "EMERGENCY" else 1.0)
        byid = {p.id: p for p in order}
        wait = crit = unserved = 0.0
        for it in items:
            p = byid[it.patient_id]
            w = it.start_time - p.arrival_time
            wait += w
            cat = urgency_category(p.urgency)
            if cat in cfg.critical_multiplier:
                crit += cfg.critical_multiplier[cat] * (w / cfg.target_wait[cat]) ** 2
        for u in unsched:
            p = byid[u["patient_id"]]
            w = (now + H) - p.arrival_time
            wait += w
            cat = urgency_category(p.urgency)
            if cat in cfg.critical_multiplier:
                crit += cfg.critical_multiplier[cat] * (w / cfg.target_wait[cat]) ** 2
            unserved += 0.5 + (p.urgency - 1) / 9.0
        travel = sum(it.travel for it in items)
        reassign = 0
        for it in items:
            pb = byid[it.patient_id].planned_bundle or {}
            if pb:
                reassign += (pb.get("bed") != it.bed_id) + (pb.get("doctor") != it.doctor_id) + \
                            len(set(it.nurse_ids) ^ set(pb.get("nurses", []))) // 2
        end_w = min(now + H, max([it.end_time for it in items], default=now))
        idle = 0.0
        if end_w > now:
            for st in self.docs_all + self.nurses_all:
                if self.avail_from[st.id] <= now < self.avail_until[st.id]:
                    booked = sum(max(0, min(b, end_w) - max(a, now)) for a, b, _ in cal.book.get(st.id, ()))
                    idle += max(0, (end_w - now) - booked)
        terms = dict(wait=J["alpha"] * wait, critical_wait=beta * crit, idle=J["gamma"] * idle,
                     travel=J["delta"] * travel, unserved=J["epsilon"] * unserved, reassign=J["zeta"] * reassign)
        terms = {k: round(v, 2) for k, v in terms.items()}
        terms["total"] = round(sum(terms.values()), 2)
        return terms

    # ------------------------------------------------------------ public API
    def plan(self, now=None):
        if now is not None:
            self.now = now
        self._prepare()
        cfg, h = self.cfg, self.h
        waiting = h.waiting()
        ranked = prio.rank(waiting, self.now, cfg, self.weights, self.pred.risk, self._avail_fraction)
        comps = {p.id: c for p, _, c in ranked}
        order = [p for p, _, _ in ranked]
        window, overflow = order[:cfg.max_plan_patients], order[cfg.max_plan_patients:]
        items, unsched, cal = self._build(window, comps)
        Jt = self.objective(items, unsched, cal, window)
        if self.st.get("local_search") and len(window) >= 2:
            for _ in range(cfg.ls_iters):
                improved = False
                for i in range(min(cfg.ls_window, len(window) - 1)):
                    cand = list(window)
                    cand[i], cand[i + 1] = cand[i + 1], cand[i]
                    it2, un2, cal2 = self._build(cand, comps)
                    J2 = self.objective(it2, un2, cal2, cand)
                    if J2["total"] < Jt["total"] - 1e-6:
                        window, items, unsched, cal, Jt, improved = cand, it2, un2, cal2, J2, True
                        break
                if not improved:
                    break
        for p in overflow:
            unsched.append(dict(patient_id=p.id, reason="Beyond the planning window (queue depth)", binding="queue", structural=False))
        items.sort(key=lambda i: (i.dispatch_time, i.patient_id))
        plan = Plan(self.now, self.mode, self.st.get("label", ""), items, unsched, comps, Jt,
                    [p.id for p in window] + [p.id for p in overflow], [], self.evals)
        plan.conflicts = self._conflicts(waiting, unsched)
        return plan

    def _avail_fraction(self, p):
        """R_p: fraction of required resource classes with a compatible unit free right now."""
        ctx = self._context(p)
        now, cal = self.now, self.base
        cls = []
        cls.append(any(self.avail_from[b.id] <= now and cal.free(b.id, now, now + 1) for b in ctx.beds))
        cls.append(any(self._okstaff(d.id, now, now + 1, cal) for d in ctx.docs))
        cls.append(sum(1 for n in ctx.nurses if self._okstaff(n.id, now, now + 1, cal)) >= p.nurses_required)
        for kind, q in p.equipment_required.items():
            cls.append(sum(1 for u in ctx.equip.get(kind, []) if cal.free(u.id, now, now + 1)) >= q)
        return sum(cls) / len(cls)

    def _conflicts(self, waiting, unsched):
        msgs, h = [], self.h
        names = {"icu": "ICU", "emergency": "Emergency", "monitored": "Monitored", "general": "General", "operating_room": "Operating-room"}
        for t in ("icu", "emergency", "monitored", "general", "operating_room"):
            need = [p for p in waiting if p.bed_type_required == t]
            if not need:
                continue
            compat = [b for b in h.beds.values() if b.type in BED_COMPAT[t]]
            free = [b for b in compat if b.status == "available"]
            oper = [b for b in compat if b.status != "unavailable"]
            if len(need) > len(free):
                unavail = len(compat) - len(oper)
                msgs.append(dict(severity="critical" if not free else "warning", kind="bed", bed_type=t,
                                 text=(f"{names[t]} capacity constrained: {len(need)} waiting patient(s) require a compatible bed but only "
                                       f"{len(free)} of {len(oper)} operational compatible bed(s) are free now"
                                       + (f" ({unavail} unavailable)" if unavail else "") + ".")))
        for u in unsched:
            if u.get("structural"):
                msgs.append(dict(severity="critical", kind="structural", patient_id=u["patient_id"], text=f"{u['patient_id']}: {u['reason']}."))
        return msgs


def why_binding(p, ctx, planner):
    if not ctx.beds:
        return f"bed:{p.bed_type_required}"
    if not ctx.docs:
        return f"doctor:{p.required_specialty}"
    zone = ctx.zones[0] if ctx.zones else ctx.home
    for kind, q in p.equipment_required.items():
        if len(ctx.equip.get(kind, [])) < q:
            return f"equip:{kind}"
    return f"nurse@{zone}"


def rank_doctors(hospital, specialty_skill, zone, now):
    """Decision-support: qualified doctors ordered by availability then travel (future doctor recommendation)."""
    out = []
    for d in hospital.doctors.values():
        if specialty_skill not in d.skills:
            continue
        if d.status == "available":
            free = now
        elif d.status in ("treating", "travelling", "assigned"):
            p = hospital.patients.get(d.current_patient)
            free = (p.pred_end if p and p.pred_end else now + 15)
        else:
            free = None
        out.append(dict(id=d.id, name=d.name, specialty=d.specialty, status=d.status,
                        free_in=None if free is None else max(0, free - now), travel=DIST[d.location][zone]))
    out.sort(key=lambda r: (r["free_in"] is None, r["free_in"] or 0, r["travel"], r["id"]))
    return out

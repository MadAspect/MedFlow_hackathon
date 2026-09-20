"""Hospital state engine + rolling-horizon simulation.

Loop (executed every simulated minute; the expensive re-optimisation only when needed):

    OBSERVE   arrivals, completions, overruns, deterioration, shift changes, failures
    UPDATE    emergency-mode indicators, bottleneck analysis
    RE-OPTIMISE  when an event happened or every `replan_interval` minutes:
                 Planner.plan()  -> commit only the assignments due NOW; the rest of the
                 plan is tentative and is recomputed at the next epoch.

The optimizer never sees the hidden ground truth (actual treatment duration, deterioration draw):
it only sees predictions.  Reality (actual end times) is revealed to the system only when a
treatment completes, or - for overruns - when the predicted end passes and the schedule breaks.
"""
from __future__ import annotations
import math, random, copy, zlib
from .config import Config, STRATEGIES, urgency_category
from .hospital import Hospital, travel, DEPT_ZONE, BED_COMPAT
from .models import ACTIVE, Doctor, Nurse
from .prediction import PredictionService
from .allocation import Planner
from .emergency import EmergencyController
from . import bottleneck as bn
from . import scenarios as scn

BUSY = ("treating", "travelling", "assigned")


def clock(t):
    m = 8 * 60 + int(t)
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


class Engine:
    def __init__(self, scenario="demo_day", strategy="full", seed=None, overrides=None, adaptive_predictor=False,
                 recommendations=True, debug=False):
        self.sc = dict(scn.SCENARIOS[scenario] if isinstance(scenario, str) else scenario)
        self.scenario_key = scenario if isinstance(scenario, str) else "custom"
        self.cfg = Config().update(self.sc.get("config")).update(overrides)
        self.cfg.baseline_rate_per_hour = self.sc.get("baseline", self.cfg.baseline_rate_per_hour)
        self.strategy_key = strategy
        self.strategy = dict(STRATEGIES[strategy])
        self.seed = seed if seed is not None else self.sc.get("seed", 1)
        self.duration = self.sc.get("duration", 720)
        self.debug, self.recommendations_on = debug, recommendations
        self.h = Hospital(self.cfg)
        self.pred = PredictionService(self.cfg, adaptive=adaptive_predictor)
        self.emergency = EmergencyController(self.cfg)
        self.now = 0
        self.arrivals = self._build_arrivals()
        self._ai = 0
        self.next_index = len(self.arrivals) + 1
        self.arrival_times, self.critical_arrival_times = [], []
        self.script = sorted(copy.deepcopy(self.sc.get("events", [])), key=lambda e: e["t"])
        self.events, self.reopts, self.impacts, self.actions, self.completed_records = [], [], [], [], []
        self.history, self.queue_hist, self.inventory_tx, self.assignments_log = [], [], [], []
        self.plan = None
        self.analysis = None
        self.recos, self.reco_time = [], -999
        self.last_auto = -999
        self.reasons = []
        self.finished = False
        self.mode_minutes = {"NORMAL": 0, "WARNING": 0, "EMERGENCY": 0, "RECOVERY": 0}
        self.n_transfers = 0
        self.n_reopts = 0
        self.log("system", f"Scenario '{self.sc['label']}' started with strategy '{self.strategy['label']}'", data={"seed": self.seed})
        self._process_time()

    def _build_arrivals(self):
        if self.sc.get("dataset"):
            from . import data_ingest
            rows, _ = data_ingest.load_csv(self.sc["dataset"] if self.sc["dataset"] != "sample" else None)
            return scn.generate_arrivals(self.sc["profile"], self.duration, self.seed, self.cfg,
                                         factory=lambda i, t, seed, cfg, mix: data_ingest.patient_from_row(rows[(i - 1) % len(rows)], i, t, seed, cfg))
        return scn.generate_arrivals(self.sc["profile"], self.duration, self.seed, self.cfg)

    # ------------------------------------------------------------------ logging
    def log(self, kind, message, severity="info", data=None):
        e = dict(id=len(self.events) + 1, t=self.now, clock=clock(self.now), type=kind, severity=severity, message=message, data=data or {})
        self.events.append(e)
        return e

    def mode(self):
        return self.emergency.state

    # ------------------------------------------------------------------ time stepping
    def step(self, minutes=1):
        for _ in range(int(minutes)):
            if self.now >= self.duration:
                self.finished = True
                break
            self._account()
            self.now += 1
            self._process_time()
            if self.debug:
                errs = self.h.check_invariants()
                assert not errs, f"t={self.now}: {errs}"
        if self.now >= self.duration:
            self.finished = True
        return self.now

    def run_to_end(self):
        while self.now < self.duration:
            self.step(1)
        return self

    def _account(self):
        """Accumulate one minute of utilisation for the state that held during [now, now+1)."""
        h = self.h
        for s in h.all_staff():
            if s.status in ("treating",):
                s.treat_minutes += 1
            if s.status in ("available",) or s.status in BUSY:
                s.available_minutes += 1
            if s.status == "available":
                s.idle_minutes += 1
        for b in h.beds.values():
            if b.status != "unavailable":
                b.available_minutes += 1
            if b.status in ("occupied", "reserved"):
                b.busy_minutes += 1
        for u in h.equipment.values():
            if u.status == "in_use":
                u.busy_minutes += 1
        for p in h.active():
            p.care_minutes += 1
        self.mode_minutes[self.emergency.state] += 1

    def _process_time(self):
        t, h = self.now, self.h
        h.now = t
        self.reasons = []
        self._scripted(t)
        self._shifts(t)
        self._timers(t)
        self._arrive(t)
        self._progress(t)
        self._deteriorate(t)
        self._transfers(t)
        tr = self.emergency.update(t, self.indicators())
        if tr:
            sev = "critical" if tr["to_state"] == "EMERGENCY" else "warning" if tr["to_state"] == "WARNING" else "info"
            self.log("mode", f"Mode {tr['from_state']} -> {tr['to_state']}: {tr['trigger']}", sev, tr)
            self.reasons.append(f"mode {tr['to_state']}")
        if self.reasons or t % self.cfg.replan_interval == 0:
            self.optimize("; ".join(dict.fromkeys(self.reasons)) or "periodic re-optimisation")
        if t % self.cfg.sample_interval == 0:
            self._sample()
        self._interventions(t)
        self._restore_temporary(t)
        if t >= self.duration:
            self.finished = True

    # ------------------------------------------------------------------ events
    def _scripted(self, t):
        while self.script and self.script[0]["t"] <= t:
            self.inject(self.script.pop(0), source="scenario")

    def inject(self, ev, source="head_nurse"):
        """Apply a scripted / manual disruption. Returns a short result dict."""
        ty = ev["type"]
        if ty == "surge":
            n = int(ev.get("n", 12))
            pts = scn.generate_surge(self.now, n, int(ev.get("window", 20)), float(ev.get("critical_frac", 0.4)), self.seed,
                                     self.next_index, self.cfg)
            self.next_index += n
            self.arrivals.extend(pts)
            self.arrivals[self._ai:] = sorted(self.arrivals[self._ai:], key=lambda p: (p.arrival_time, p.id))
            self.log("surge", f"Emergency surge injected: {n} patients over {ev.get('window', 20)} min ({source})", "warning")
            return dict(injected=n)
        if ty == "overrun":
            cand = [p for p in self.h.active() if p.status == "in_treatment" and p.predicted_duration >= ev.get("min_expected", 0)
                    and (ev.get("patient_id") in (None, p.id))]
            if not cand:
                return dict(error="no matching in-treatment patient")
            p = max(cand, key=lambda q: (q.predicted_duration, q.id))
            remaining = p.end_time - self.now
            p.end_time = self.now + max(1, int(math.ceil(remaining * ev.get("factor", 1.8))))
            p.actual_total += p.end_time - (self.now + remaining)
            self.log("disruption", f"Ground truth changed: treatment of {p.id} will take longer than planned (system not told)", "info", dict(patient=p.id))
            return dict(patient=p.id)
        if ty in ("staff_unavailable", "bed_failure", "equipment_failure"):
            key = {"staff_unavailable": "staff_unavailable", "bed_failure": "bed_unavailable", "equipment_failure": "equipment_unavailable"}[ty]
            res = []
            for i in ev.get("ids", []):
                res.append(self.apply_change(dict(type=key, id=i, reason=ev.get("reason", "reported"), until=ev.get("until")), source=source))
            return dict(changes=len(res))
        if ty == "deteriorate":
            p = self.h.patients.get(ev["patient_id"])
            if p and p.status == "waiting":
                self._do_deteriorate(p)
            return {}
        raise ValueError(f"unknown event type {ty}")

    def _shifts(self, t):
        for s in self.h.all_staff():
            if s.on_call:
                if s.status in BUSY or s.status == "available":
                    pass
                continue
            if s.status == "off_shift" and s.shift_start <= t < s.shift_end:
                s.status = "available"
                s.notify(t, f"Shift started ({s.shift_label})")
                self.log("shift", f"{s.name} ({s.id}) came on shift", data=dict(id=s.id))
                self.reasons.append("staff on shift")
            elif t >= s.shift_end and s.status not in ("off_shift",):
                if s.status in BUSY:
                    s.leaving = True
                elif s.status in ("available", "unavailable"):
                    s.status = "off_shift"
                    self.reasons.append("shift ended")

    def _timers(self, t):
        h = self.h
        for s in h.all_staff():
            if s.status == "unavailable" and s.unavailable_until and t >= s.unavailable_until:
                s.status, s.unavailable_reason, s.unavailable_until = "available", "", None
                s.notify(t, "You are available again")
                self.log("resource", f"{s.name} ({s.id}) available again", data=dict(id=s.id))
                self.reasons.append("staff returned")
            if s.status == "travelling" and s.current_patient is None and s.busy_until and t >= s.busy_until:
                s.status, s.location, s.busy_until = "available", (s.target_zone or s.location), None
                s.target_zone = None
                s.notify(t, f"Arrived at {s.location}: ready for assignments")
                self.reasons.append("relocation complete")
        for b in h.beds.values():
            if b.status == "cleaning" and t >= (b.cleaning_until or 0):
                b.status, b.cleaning_until = "available", None
                self.reasons.append("bed ready")
            elif b.status == "unavailable" and b.unavailable_until and t >= b.unavailable_until:
                b.status, b.unavailable_reason, b.unavailable_until = "available", "", None
                self.log("resource", f"Bed {b.id} back in service")
                self.reasons.append("bed restored")

    def _arrive(self, t):
        while self._ai < len(self.arrivals) and self.arrivals[self._ai].arrival_time <= t:
            p = self.arrivals[self._ai]
            self._ai += 1
            self.h.patients[p.id] = p
            self.arrival_times.append(t)
            if p.urgency >= 8:
                self.critical_arrival_times.append(t)
            self.log("arrival", f"{p.id} {p.name} arrived: {p.initial_diagnosis} - urgency {p.urgency} ({p.risk_category}), needs {p.bed_type_required} bed",
                     "warning" if p.urgency >= 8 else "info", dict(patient=p.id))
            self.reasons.append("arrival")

    def add_patient(self, payload):
        """Manually admit a patient now (POST /api/patients): symptoms/vitals -> expert system -> queue."""
        from . import expert
        syms = payload.get("symptoms") or []
        ev = expert.evaluate(syms, payload.get("vitals") or {}, int(payload.get("age", 40)), self.cfg)
        if payload.get("urgency"):
            ev["urgency"] = int(payload["urgency"])
            ev["risk_category"] = urgency_category(ev["urgency"])
        rng = random.Random(self.seed * 31 + self.next_index)
        pid = f"P{self.next_index:03d}"
        self.next_index += 1
        p = scn.patient_from_expert(pid, payload.get("name") or f"Walk-in {pid}", self.now, int(payload.get("age", 40)), syms,
                                    payload.get("vitals") or {}, ev, rng, self.cfg, "manual", expert.diagnosis_text(syms, ev))
        self.h.patients[p.id] = p
        self.arrival_times.append(self.now)
        self.log("arrival", f"{p.id} {p.name} added manually: urgency {p.urgency} ({p.risk_category})", "info", dict(patient=p.id))
        self.optimize("manual patient arrival")
        return p

    def _deteriorate(self, t):
        for p in self.h.waiting():
            if p.wait_so_far(t) >= p.hazard_draw and p.deteriorations < 2 and p.urgency < 10:
                self._do_deteriorate(p)

    def _do_deteriorate(self, p):
        old = p.urgency
        p.urgency = min(10, p.urgency + 1)
        p.deteriorations += 1
        p.hazard_draw = p.wait_so_far(self.now) + (random.Random(self.seed + int(self.now) + zlib.crc32(p.id.encode()) % 997).expovariate(
            self.cfg.hazard_per_min[urgency_category(p.urgency)]) if self.cfg.hazard_per_min[urgency_category(p.urgency)] > 0 else 1e9)
        p.risk_category = urgency_category(p.urgency)
        p.log(self.now, f"deteriorated while waiting: urgency {old} -> {p.urgency}")
        self.log("deterioration", f"{p.id} deteriorated while waiting (urgency {old} -> {p.urgency})", "warning", dict(patient=p.id))
        self.reasons.append("patient deterioration")

    def _transfers(self, t):
        for p in self.h.waiting():
            if p.conflict and p.wait_so_far(t) >= self.cfg.transfer_after_wait and p.conflict.startswith("No "):
                p.status, p.completed_time = "transferred", t
                p.log(t, f"transferred out: {p.conflict}")
                self.n_transfers += 1
                self.log("transfer", f"{p.id} transferred to another facility: {p.conflict}", "warning", dict(patient=p.id))

    # ------------------------------------------------------------------ treatment progress
    def _progress(self, t):
        h = self.h
        for p in sorted(h.active(), key=lambda q: q.id):
            if p.status == "assigned" and t >= p.start_time:
                self._begin(p)
            if p.status == "in_treatment":
                if t >= p.end_time:
                    self._complete(p)
                elif t >= p.pred_end:
                    ext = self.pred.extension(p)
                    if not p.overrun_flagged:
                        p.overrun_flagged = True
                        el = t - p.start_time
                        self.log("overrun", f"{p.id} still in treatment after {el} min (expected {round(p.predicted_duration)}): schedule deviates, re-optimising downstream assignments",
                                 "warning", dict(patient=p.id, expected=round(p.predicted_duration), elapsed=el))
                        p.log(t, "treatment overrun detected")
                    while p.pred_end <= t:
                        p.pred_end += ext
                    h.beds[p.current_bed].expected_completion = p.pred_end
                    self.reasons.append(f"overrun of {p.id}")

    def _begin(self, p):
        h = self.h
        bed = h.beds[p.current_bed]
        bed.status = "occupied"
        for sid in [p.assigned_doctor] + list(p.assigned_nurses):
            s = h.staff(sid)
            s.status, s.location, s.target_zone, s.busy_until = "treating", bed.zone, None, None
        p.status = "in_treatment"
        p.start_time = self.now
        p.log(self.now, f"treatment started in {bed.id}")

    def _free_staff(self, s):
        s.current_patient = None
        if s.status in BUSY:
            s.status = "off_shift" if s.leaving else "available"
            if s.leaving:
                s.leaving = False

    def _release(self, p, bed_status="cleaning", equip_status="available"):
        h = self.h
        bed = h.beds.get(p.current_bed)
        if bed:
            bed.patient_id, bed.doctor_id, bed.nurse_ids, bed.expected_completion = None, None, [], None
            if bed.status in ("occupied", "reserved"):
                bed.status = bed_status
                if bed_status == "cleaning":
                    bed.cleaning_until = self.now + self.cfg.cleaning_minutes.get(bed.type, self.cfg.cleaning_minutes["default"])
        for sid in [p.assigned_doctor] + list(p.assigned_nurses):
            s = h.staff(sid)
            if s:
                self._free_staff(s)
        for u in p.equipment_units:
            e = h.equipment.get(u)
            if e:
                e.patient_id = None
                if e.status == "in_use":
                    e.status = equip_status
        p.current_bed, p.assigned_doctor, p.assigned_nurses, p.equipment_units = None, None, [], []

    def _complete(self, p):
        t, h = self.now, self.h
        p.work_done += t - p.start_time
        p.treatment_time_actual = round(p.work_done, 1)
        p.status, p.completed_time = "completed", t
        bed_id = p.current_bed
        doc = p.assigned_doctor
        nurses = list(p.assigned_nurses)
        self._release(p)
        for item, q in p.consumption.items():
            c = h.consumables.get(item)
            if c:
                c.allocated = max(0.0, c.allocated - q)
                c.quantity = max(0.0, c.quantity - q)
                c.consumed += q
                self.inventory_tx.append(dict(t=t, item=item, delta=-q, reason=f"treatment {p.id}"))
                if c.quantity <= 0:
                    self.log("inventory", f"STOCK-OUT: {item}", "critical")
        p.reserved_supplies = False
        wait = p.wait_at_first_start(t)
        self.pred.observe(p, p.predicted_duration, p.work_done)
        p.log(t, f"treatment completed (expected {round(p.predicted_duration)} min, actual {round(p.work_done)} min)")
        self.completed_records.append(dict(id=p.id, t=t, department=p.department, category=urgency_category(p.urgency),
                                           expected=round(p.predicted_duration, 1), actual=round(p.work_done, 1), wait=wait,
                                           bed=bed_id, doctor=doc, nurses=nurses))
        dev = p.work_done - p.predicted_duration
        self.log("completion", f"{p.id} completed in {bed_id}: expected {round(p.predicted_duration)} min, actual {round(p.work_done)} min ({dev:+.0f})",
                 "info", dict(patient=p.id))
        self.reasons.append("completion")

    # ------------------------------------------------------------------ optimisation
    def indicators(self):
        h, t, cfg = self.h, self.now, self.cfg
        waiting = h.waiting()
        crit = [p for p in waiting if p.urgency >= 8]
        icu_free = sum(1 for b in h.beds.values() if b.type == "icu" and b.status == "available")
        icu_wait = sum(1 for p in waiting if p.bed_type_required == "icu")
        staff = [s for s in h.all_staff() if not s.on_call or s.status != "off_shift"]
        onshift = [s for s in staff if s.status not in ("off_shift",)]
        unavail = sum(1 for s in onshift if s.status == "unavailable")
        win = cfg.surge_window
        recent = sum(1 for a in self.arrival_times if a > t - win)
        rate = recent * 60.0 / win
        failures = sum(1 for b in h.beds.values() if b.status == "unavailable" and b.type in ("icu", "operating_room", "emergency")) + \
            sum(1 for u in h.equipment.values() if u.status == "unavailable")
        return dict(
            critical_queue=len(crit),
            critical_wait=max([p.wait_so_far(t) for p in crit], default=0),
            icu_slack=icu_free - icu_wait,
            staff_shortage=unavail / max(1, len(onshift)),
            arrival_surge=(rate / cfg.baseline_rate_per_hour) if recent >= 6 else 0.0,
            queue_length=len(waiting),
            capacity_pressure=(self.analysis or {}).get("peak_score", 0.0) if waiting else 0.0,
            critical_burst=sum(1 for a in self.critical_arrival_times if a > t - 10),
            resource_failures=failures,
            deterioration=sum(1 for p in waiting if p.deteriorations > 0))

    def _mode_for_planning(self):
        return "EMERGENCY" if self.emergency.state == "EMERGENCY" else "NORMAL"

    def optimize(self, reason="on demand"):
        """One rolling-horizon epoch: plan, commit what is due now, keep the rest tentative."""
        h, t = self.h, self.now
        h.now = t
        old = {p.id: (p.planned_start, dict(p.planned_bundle)) for p in h.waiting()}
        planner = Planner(h, self.cfg, self.strategy, self.pred, self._mode_for_planning())
        plan = planner.plan(t)
        committed = []
        for it in plan.immediate():
            if self._commit(it):
                committed.append(it)
        plan.items = [i for i in plan.items if i.patient_id not in {c.patient_id for c in committed}]
        items = plan.by_patient()
        unsched = {u["patient_id"]: u for u in plan.unscheduled}
        changes = []
        for p in h.waiting():
            it = items.get(p.id)
            comp = plan.scores.get(p.id)
            if comp:
                p.priority = comp
            p.planned_start = it.start_time if it else None
            p.planned_bundle = dict(bed=it.bed_id, doctor=it.doctor_id, nurses=list(it.nurse_ids)) if it else {}
            u = unsched.get(p.id)
            p.conflict = u["reason"] if (u and u.get("structural")) else ""
            p.binding_class = it.binding if it else (u["binding"] if u else "")
            if p.id in old:
                ps, pb = old[p.id]
                if it and ps is not None and abs(it.start_time - ps) >= 2:
                    changes.append(dict(patient=p.id, was=ps, now=it.start_time, delta=it.start_time - ps))
                elif it and pb and pb != p.planned_bundle:
                    changes.append(dict(patient=p.id, was=ps, now=it.start_time, delta=0, note="resources changed"))
        self.plan = plan
        self.analysis = bn.analyze(h, plan, t, self.cfg, self._queue_ref())
        self.n_reopts += 1
        rec = dict(seq=self.n_reopts, t=t, clock=clock(t), reason=reason, mode=self._mode_for_planning(), waiting=len(h.waiting()), committed=[c.patient_id for c in committed],
                   J=plan.J, evaluations=plan.evaluations, plan_changes=changes[:12], n_changes=len(changes),
                   conflicts=[c["text"] for c in plan.conflicts][:4])
        self.reopts.append(rec)
        del self.reopts[:-400]
        return rec

    def _queue_ref(self):
        """(t, per-class queue) from ~growth_window minutes ago."""
        ref = None
        for tt, q in self.queue_hist:
            if tt <= self.now - self.cfg.growth_window:
                ref = (tt, q)
        return [ref] if ref else []

    def _commit(self, it):
        h, t = self.h, self.now
        p = h.patients[it.patient_id]
        bed, doc = h.beds[it.bed_id], h.doctors[it.doctor_id]
        nurses = [h.nurses[n] for n in it.nurse_ids]
        eq = [h.equipment[u] for u in it.equipment_ids]
        ok = p.status == "waiting" and bed.status == "available" and bed.type in BED_COMPAT[p.bed_type_required]
        ok = ok and doc.status == "available" and p.required_specialty in doc.skills
        ok = ok and all(n.status == "available" and set(p.required_nurse_skills) <= set(n.skills) and bed.zone in n.covered_zones for n in nurses)
        ok = ok and len(nurses) == p.nurses_required and all(e.status == "available" for e in eq)
        if not ok:
            self.log("system", f"Commit of {p.id} rejected: state changed", "warning")
            return False
        staff = [doc] + nurses
        trav = {s.id: travel(s.location, bed.zone) for s in staff}
        T = t + max(trav.values())
        remaining = max(1, int(math.ceil(p.actual_total - p.work_done)))
        p.predicted_duration = p.predicted_duration if p.first_start_time is not None else self.pred.expected_total(p)
        dur = it.duration
        p.start_time, p.end_time, p.pred_end = T, T + remaining, T + dur
        p.assign_time = t
        if p.first_start_time is None:
            p.first_start_time = T
        p.status, p.current_bed, p.assigned_doctor, p.assigned_nurses = "assigned", bed.id, doc.id, [n.id for n in nurses]
        p.equipment_units = [e.id for e in eq]
        p.overrun_flagged, p.conflict, p.planned_start, p.planned_bundle = False, "", None, {}
        bed.status, bed.patient_id, bed.doctor_id, bed.nurse_ids, bed.expected_completion = "reserved", p.id, doc.id, p.assigned_nurses, p.pred_end
        for e in eq:
            e.status, e.patient_id = "in_use", p.id
        for s in staff:
            s.current_patient = p.id
            s.assignments += 1
            s.travel_minutes += trav[s.id]
            s.status = "travelling" if trav[s.id] > 0 else "assigned"
            s.target_zone = bed.zone if trav[s.id] > 0 else None
            s.notify(t, f"Assigned {p.id} ({p.name}) - {bed.label or bed.id}, {bed.zone}; travel {trav[s.id]} min", "info")
        if not p.reserved_supplies:
            for item, q in p.consumption.items():
                if item in h.consumables:
                    h.consumables[item].allocated += q
            p.reserved_supplies = True
        p.log(t, f"assigned bed {bed.id}, {doc.id}, {','.join(p.assigned_nurses)}; treatment starts {T}")
        self.assignments_log.append(dict(t=t, patient_id=p.id, bed_id=bed.id, doctor_id=doc.id, nurse_ids=p.assigned_nurses, start=T,
                                         expected_end=p.pred_end, reason=self.reasons[-1] if self.reasons else ""))
        self.log("assignment", f"{p.id} -> {bed.id}, {doc.name}, {', '.join(n.name for n in nurses)} (starts {clock(T)})", "info", dict(patient=p.id))
        if T <= t:
            self._begin(p)
        return True

    # ------------------------------------------------------------------ resource changes (Head Nurse control)
    def _bundles(self):
        out = {}
        for p in self.h.patients.values():
            if p.status in ACTIVE:
                out[p.id] = dict(status=p.status, bed=p.current_bed, doctor=p.assigned_doctor, nurses=list(p.assigned_nurses), start=p.start_time)
            elif p.status == "waiting":
                out[p.id] = dict(status="planned" if p.planned_bundle else "waiting", start=p.planned_start, **(p.planned_bundle or {}))
        return out

    def _interrupt(self, p, reason):
        if p.status == "in_treatment":
            p.work_done += self.now - p.start_time
        old = dict(bed=p.current_bed, doctor=p.assigned_doctor, nurses=list(p.assigned_nurses))
        for sid in [p.assigned_doctor] + list(p.assigned_nurses):
            s = self.h.staff(sid)
            if s:
                s.notify(self.now, f"Assignment to {p.id} cancelled: {reason}", "warning")
        self._release(p, bed_status="available")
        p.status, p.start_time, p.pred_end, p.end_time = "waiting", None, None, None
        p.interruptions += 1
        p.planned_bundle = old
        p.log(self.now, f"interrupted: {reason}")

    def _substitute(self, p, old_id):
        """Replace a lost staff member inside a running bundle if a qualified free replacement exists."""
        h = self.h
        bed = h.beds[p.current_bed]
        is_doc = old_id == p.assigned_doctor
        pool = h.doctors.values() if is_doc else h.nurses.values()
        need = {p.required_specialty} if is_doc else set(p.required_nurse_skills)
        cands = [s for s in pool if s.status == "available" and need <= set(s.skills) and (is_doc or bed.zone in s.covered_zones)
                 and (s.on_call or s.shift_end - self.cfg.shift_end_buffer > self.now)]
        if not cands:
            return None
        cnt = h.skill_counts()
        sub = min(cands, key=lambda s: (travel(s.location, bed.zone), sum(1.0 / max(1, cnt.get((s.role, k), 1)) for k in s.skills if k not in need),
                                        s.workload, s.id))
        tr = travel(sub.location, bed.zone)
        sub.status, sub.current_patient, sub.location = ("treating" if p.status == "in_treatment" else "assigned"), p.id, bed.zone
        sub.travel_minutes += tr
        sub.assignments += 1
        if is_doc:
            p.assigned_doctor = sub.id
            bed.doctor_id = sub.id
        else:
            p.assigned_nurses = [sub.id if n == old_id else n for n in p.assigned_nurses]
            bed.nurse_ids = list(p.assigned_nurses)
        sub.notify(self.now, f"Reassigned to {p.id} in {bed.label or bed.id} to cover for {old_id}", "warning")
        return sub, tr

    def apply_change(self, ch, source="head_nurse"):
        """Every resource change flows through here: update state -> find affected assignments ->
        check feasibility -> substitute / interrupt -> re-optimise -> explain."""
        h, t = self.h, self.now
        before = self._bundles()
        ty = ch["type"]
        affected, notified, summary = [], [], ""
        reason = ch.get("reason", "")
        if ty == "staff_unavailable":
            s = h.staff(ch["id"])
            summary = f"{s.role.title()} {s.id} ({s.name}) marked unavailable" + (f" - {reason}" if reason else "")
            pid = s.current_patient
            s.unavailable_reason, s.unavailable_until = reason or "unavailable", ch.get("until")
            if pid:
                p = h.patients[pid]
                res = self._substitute(p, s.id) if p.status in ACTIVE else None
                s.current_patient, s.status = None, "unavailable"
                if res:
                    sub, tr = res
                    affected.append(dict(patient=pid, action="substituted", detail=f"{sub.id} ({sub.name}) took over, travel {tr} min"))
                    notified.append(sub.id)
                else:
                    self._interrupt(p, f"{s.id} became unavailable and no qualified replacement is free")
                    affected.append(dict(patient=pid, action="interrupted", detail="no qualified free replacement; patient re-queued with progress kept"))
                    notified += [x for x in [p.planned_bundle.get('doctor')] + list(p.planned_bundle.get('nurses', [])) if x and x != s.id]
            s.status = "unavailable"
        elif ty == "staff_available":
            s = h.staff(ch["id"])
            s.status, s.unavailable_reason, s.unavailable_until = ("available" if not s.leaving else "off_shift"), "", None
            summary = f"{s.role.title()} {s.id} ({s.name}) available again"
        elif ty == "bed_unavailable":
            b = h.beds[ch["id"]]
            summary = f"Bed {b.id} ({b.type}, {b.zone}) marked unavailable" + (f" - {reason}" if reason else "")
            if b.patient_id:
                p = h.patients[b.patient_id]
                self._interrupt(p, f"bed {b.id} failed")
                affected.append(dict(patient=p.id, action="interrupted", detail="patient must be relocated to another compatible bed"))
            b.status, b.unavailable_reason, b.unavailable_until = "unavailable", reason or "unavailable", ch.get("until")
            b.patient_id, b.cleaning_until = None, None
        elif ty == "bed_available":
            b = h.beds[ch["id"]]
            b.status, b.unavailable_reason, b.unavailable_until = "available", "", None
            summary = f"Bed {b.id} restored to service"
        elif ty == "equipment_unavailable":
            u = h.equipment.get(ch.get("id")) or next((x for x in h.equipment.values() if x.kind == ch.get("kind") and x.status == "available"), None)
            if u is None:
                return dict(error="no such equipment unit")
            summary = f"Equipment {u.id} ({u.kind}) failed" + (f" - {reason}" if reason else "")
            if u.patient_id:
                p = h.patients[u.patient_id]
                self._interrupt(p, f"equipment {u.id} failed")
                affected.append(dict(patient=p.id, action="interrupted", detail="equipment lost; patient re-queued"))
            u.status, u.patient_id, u.unavailable_reason = "unavailable", None, reason or "failure"
        elif ty == "equipment_available":
            u = h.equipment[ch["id"]]
            u.status, u.unavailable_reason = "available", ""
            summary = f"Equipment {u.id} restored"
        elif ty in ("move_nurse", "activate_staff", "open_bed", "add_equipment"):
            oid = bn.apply_action(h, ch, t)
            summary = {"move_nurse": f"Nurse {oid} redeployed to {ch.get('zone')}", "activate_staff": f"Staff {oid} called in",
                       "open_bed": f"Temporary bed {oid} opened ({ch.get('bed_type')}, {ch.get('zone')})",
                       "add_equipment": f"Temporary equipment {oid} added"}[ty]
            s = h.staff(oid) if ty in ("move_nurse", "activate_staff") else None
            if s:
                s.notify(t, summary + (f" (from {ch.get('from_zone')})" if ch.get("from_zone") else ""), "warning")
                notified.append(s.id)
        elif ty == "add_bed":
            oid = bn.apply_action(h, dict(ch, type="open_bed", bed_type=ch["bed_type"]), t)
            summary = f"Bed {oid} added"
        elif ty == "remove_bed":
            b = h.beds[ch["id"]]
            if b.status in ("occupied", "reserved"):
                return dict(error="bed is in use; mark it unavailable instead")
            del h.beds[b.id]
            summary = f"Bed {b.id} removed"
        elif ty == "add_staff":
            cls = Doctor if ch["role"] == "doctor" else Nurse
            n = sum(1 for x in (h.doctors if ch["role"] == "doctor" else h.nurses).values())
            sid = f"{'D' if ch['role'] == 'doctor' else 'N'}{n + 1:02d}"
            s = cls(sid, ch.get("name") or f"Temporary {ch['role']} {sid}", ch["role"], skills=list(ch.get("skills", [])), shift_label="Temporary",
                    shift_start=t, shift_end=10 ** 6, on_call=True, location=ch.get("zone", "HUB"), home_zone=ch.get("zone", "HUB"),
                    covered_zones=[ch.get("zone", "HUB")], specialty=ch.get("specialty", ""))
            s.status = "available"
            (h.doctors if ch["role"] == "doctor" else h.nurses)[sid] = s
            summary = f"Temporary {ch['role']} {sid} added"
        elif ty == "remove_equipment":
            n = int(ch.get("qty", 1))
            for u in [x for x in h.equipment.values() if x.kind == ch["kind"] and x.status == "available"][:n]:
                del h.equipment[u.id]
            summary = f"{n} {ch['kind']} unit(s) removed"
        elif ty == "adjust_consumable":
            c = h.consumables[ch["item"]]
            d = float(ch["set"]) - c.quantity if "set" in ch else float(ch.get("delta", 0))
            c.quantity = max(0.0, c.quantity + d)
            if d > 0:
                c.restocked += d
            self.inventory_tx.append(dict(t=t, item=c.item, delta=d, reason=f"manual adjustment ({source})"))
            summary = f"{c.item} adjusted by {d:+.0f} (now {c.quantity:.0f})"
        else:
            raise ValueError(f"unknown change {ty}")
        self.log("resource", summary, "warning", dict(change=ch, source=source))
        self.reasons.append("resource change")
        self.optimize(f"resource change: {summary}")
        after = self._bundles()
        for a in affected:
            pid = a["patient"]
            a["before"], a["after"] = before.get(pid), after.get(pid)
            p = h.patients[pid]
            a["explanation"] = self._explain_new(p)
        impact = dict(t=t, clock=clock(t), change=summary, source=source, affected=affected, notified=sorted(set(notified)),
                      conflicts=[c["text"] for c in self.plan.conflicts][:5], mode=self.emergency.state,
                      bottleneck=(self.analysis["primary"]["key"] if self.analysis and self.analysis.get("primary") else None),
                      remaining_capacity=self._capacity_summary(),
                      requeued=[p.id for p in h.waiting() if p.interruptions > 0][:10])
        self.impacts.append(impact)
        del self.impacts[:-50]
        return impact

    def _explain_new(self, p):
        if p.status in ACTIVE:
            sids = [p.assigned_doctor] + list(p.assigned_nurses)
            bed = self.h.beds[p.current_bed]
            return f"{p.id} now handled by {', '.join(sids)} in {bed.id}: all hold the required skills and cover {bed.zone}."
        if p.planned_bundle:
            pb = p.planned_bundle
            return f"{p.id} re-planned: {pb.get('doctor')} + {','.join(pb.get('nurses', []))} in {pb.get('bed')} from t+{max(0, (p.planned_start or self.now) - self.now)} min (lowest-cost feasible bundle)."
        return f"{p.id} waiting: {p.conflict or 'no free qualified resources yet'}"

    def _capacity_summary(self):
        h = self.h
        on = lambda pool: sum(1 for s in pool.values() if s.status not in ("off_shift", "unavailable"))
        return dict(doctors_active=on(h.doctors), doctors_total=len(h.doctors), nurses_active=on(h.nurses), nurses_total=len(h.nurses),
                    beds=h.bed_counts())

    # ------------------------------------------------------------------ interventions / bottlenecks
    def refresh_recommendations(self, force=False):
        if not self.analysis:
            return self.recos
        if not force and self.now - self.reco_time < self.cfg.reco_interval:
            return self.recos
        self.reco_time = self.now
        nt = sum(1 for b in self.h.beds.values() if b.temporary)
        self.recos = bn.recommend(self.h, self.analysis, self.strategy, self.pred, self.cfg, self._mode_for_planning(), self.now, nt)
        return self.recos

    def apply_recommendation(self, rank_or_action, source="head_nurse"):
        recs = self.refresh_recommendations(force=True) if not self.recos else self.recos
        if isinstance(rank_or_action, dict):
            act = rank_or_action
        else:
            r = next((x for x in recs if x.get("rank") == int(rank_or_action)), None)
            if not r:
                return dict(error="recommendation not found")
            act = r["action"]
        imp = self.apply_change(dict(act), source=source)
        self.recos, self.reco_time = [], -999
        return imp

    def _interventions(self, t):
        if not self.recommendations_on or not self.strategy.get("auto_reallocate"):
            return
        need = self.emergency.state in ("WARNING", "EMERGENCY") or (self.analysis and self.analysis.get("primary") and self.analysis["primary"]["score"] >= 1.5)
        if not need or not self.h.waiting():
            return
        recs = self.refresh_recommendations()
        if self.emergency.state == "EMERGENCY" and recs and t - self.last_auto >= self.cfg.auto_cooldown:
            r = recs[0]
            self.last_auto = t
            imp = self.apply_change(dict(r["action"]), source="optimizer")
            act = dict(t=t, clock=clock(t), action=r["action"], title=r["title"], why=r["why"], predicted_impact=r["impact"],
                       trigger=self.emergency.trigger, result=imp)
            self.actions.append(act)
            self.log("action", f"EMERGENCY MODE action: {r['title']} (predicted average wait {r['impact']['avg_wait_before']} -> {r['impact']['avg_wait_after']} min)",
                     "critical", dict(action=r["action"]))
            self.recos, self.reco_time = [], -999

    def _restore_temporary(self, t):
        if self.emergency.state != "NORMAL" or t - self.emergency.since < self.cfg.restore_after_normal_min:
            return
        h = self.h
        for n in h.nurses.values():
            if n.relocated_from and n.status == "available" and n.home_zone != n.relocated_from:
                back = n.relocated_from
                self.apply_change(dict(type="move_nurse", id=n.id, zone=back, from_zone=n.home_zone), source="optimizer")
                n.relocated_from = None
                self.log("action", f"{n.name} ({n.id}) returned to {back} (hospital back to NORMAL)", "info")
        for b in list(h.beds.values()):
            if b.temporary and b.status == "available":
                del h.beds[b.id]
                self.log("resource", f"Temporary bed {b.id} closed")

    # ------------------------------------------------------------------ sampling
    def utilization(self):
        h = self.h

        def frac(items, busy_fn, ok_fn=lambda x: True):
            pool = [x for x in items if ok_fn(x)]
            return round(sum(1 for x in pool if busy_fn(x)) / len(pool), 3) if pool else 0.0
        opstaff = lambda s: s.status not in ("off_shift", "unavailable")
        busy_s = lambda s: s.status in BUSY
        bed_busy = lambda b: b.status in ("occupied", "reserved")
        bed_ok = lambda b: b.status != "unavailable"
        return dict(doctor=frac(h.doctors.values(), busy_s, opstaff), nurse=frac(h.nurses.values(), busy_s, opstaff),
                    bed=frac(h.beds.values(), bed_busy, bed_ok),
                    icu=frac([b for b in h.beds.values() if b.type == "icu"], bed_busy, bed_ok),
                    emergency=frac([b for b in h.beds.values() if b.type == "emergency"], bed_busy, bed_ok),
                    operating_room=frac([b for b in h.beds.values() if b.type == "operating_room"], bed_busy, bed_ok),
                    equipment=frac(h.equipment.values(), lambda u: u.status == "in_use", lambda u: u.status != "unavailable"))

    def _sample(self):
        h, t = self.h, self.now
        waiting = h.waiting()
        started = [p for p in h.patients.values() if p.first_start_time is not None and p.first_start_time <= t]
        waits = [p.wait_at_first_start(t) for p in started]
        self.queue_hist.append((t, dict(self.analysis["queue"]) if self.analysis else {}))
        del self.queue_hist[:-60]
        prim = self.analysis["primary"] if self.analysis else None
        s = dict(t=t, clock=clock(t), arrivals=len(self.arrival_times), queue=len(waiting), critical_queue=sum(1 for p in waiting if p.urgency >= 8),
                 in_treatment=len(h.active()), completed=sum(1 for p in h.patients.values() if p.status == "completed"),
                 avg_wait=round(sum(waits) / len(waits), 2) if waits else 0.0,
                 queue_wait=round(sum(p.wait_so_far(t) for p in waiting) / len(waiting), 2) if waiting else 0.0,
                 mode=self.emergency.state, bottleneck=prim["key"] if prim else None, bottleneck_score=prim["score"] if prim else 0.0,
                 bottleneck_blocked=prim["n_blocked"] if prim else 0, bottleneck_cause=prim.get("cause", "") if prim else "",
                 peak_score=self.analysis["peak_score"] if self.analysis else 0.0,
                 util=self.utilization(), beds=h.bed_counts(),
                 stock={k: round(c.quantity) for k, c in h.consumables.items()})
        self.history.append(s)

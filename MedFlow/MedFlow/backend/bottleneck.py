"""Bottleneck detection and counterfactual interventions.

For every resource class r (nurses per zone, doctors per skill, beds per type,
equipment per kind):
    U_r  = busy_r / capacity_r                         utilisation
    DP_r = min(3, (busy_r + queued_r) / capacity_r)    demand / capacity pressure
    QG_r = 1 + max(0, queue_r(t) - queue_r(t-W)) / max(1, capacity_r)   queue-growth pressure
    B_r  = U_r * DP_r * QG_r                           bottleneck score
A class is a bottleneck when B_r >= threshold AND patients are actually blocked on it.
"Blocked on r" comes from the planner: the resource role that became available LAST for a
patient (binding role) is that patient's delay source; delay = planned start - now.

Interventions (move a nurse, call in on-call staff, open a temporary bed, borrow equipment) are
evaluated COUNTERFACTUALLY: the planner is re-run on a cloned hospital with the change applied and
the projected waiting times compared.  Impact numbers therefore come from the model, not from text.
"""
from __future__ import annotations
import copy
from .hospital import travel, DEPT_ZONE, ZONES
from .allocation import Planner
from .models import Bed, EquipmentUnit

BUSY = ("treating", "travelling", "assigned")
WARDS = ["EMERGENCY", "ICU", "WARD_A", "WARD_B", "WARD_C", "OR"]


def _operational(s):
    return s.status not in ("unavailable", "off_shift")


def patient_zone(p, plan_items):
    it = plan_items.get(p.id)
    return None if it is None else None


def analyze(h, plan, now, cfg, queue_hist):
    items = plan.by_patient() if plan else {}
    unsched = {u["patient_id"]: u for u in (plan.unscheduled if plan else [])}
    classes = {}

    def cls(key, label, cap, busy):
        classes[key] = dict(key=key, label=label, capacity=cap, busy=busy, queued=0, blocked=[], delay=0.0)

    for z in WARDS:
        ns = [n for n in h.nurses.values() if z in n.covered_zones and _operational(n)]
        cls(f"nurse@{z}", f"Nurses - {ZONES[z]['label']}", len(ns), sum(1 for n in ns if n.status in BUSY))
    for sk in ("emergency", "critical_care", "cardiology", "neurology", "orthopedics", "surgery", "general"):
        ds = [d for d in h.doctors.values() if sk in d.skills and _operational(d)]
        cls(f"doctor:{sk}", f"Doctors - {sk.replace('_', ' ')}", len(ds), sum(1 for d in ds if d.status in BUSY))
    for t in ("emergency", "icu", "monitored", "general", "operating_room"):
        bs = [b for b in h.beds.values() if b.type == t and b.status != "unavailable"]
        cls(f"bed:{t}", f"Beds - {t.replace('_', ' ')}", len(bs), sum(1 for b in bs if b.status in ("occupied", "reserved")))
    for kind in sorted({u.kind for u in h.equipment.values()}):
        us = [u for u in h.equipment.values() if u.kind == kind and u.status != "unavailable"]
        cls(f"equip:{kind}", f"Equipment - {kind.replace('_', ' ')}", len(us), sum(1 for u in us if u.status == "in_use"))

    qnow = {k: 0 for k in classes}
    for p in h.waiting():
        it = items.get(p.id)
        z = h.beds[it.bed_id].zone if it else DEPT_ZONE.get(p.department, "EMERGENCY")
        needs = {f"nurse@{z}": p.nurses_required, f"doctor:{p.required_specialty}": 1, f"bed:{p.bed_type_required}": 1}
        for k, q in p.equipment_required.items():
            needs[f"equip:{k}"] = q
        for k, q in needs.items():
            if k in classes:
                classes[k]["queued"] += q
                qnow[k] += q
        bind = it.binding if it else unsched.get(p.id, {}).get("binding")
        if bind in classes:
            delay = (it.start_time - now) if it else cfg.horizon
            if delay > 0:
                classes[bind]["blocked"].append(p.id)
                classes[bind]["delay"] += delay
    prev = queue_hist[0][1] if queue_hist else {}
    out = []
    for k, c in classes.items():
        cap = c["capacity"]
        if cap == 0 and c["queued"] == 0:
            continue
        U = (c["busy"] / cap) if cap else (1.0 if c["queued"] else 0.0)
        DP = min(3.0, (c["busy"] + c["queued"]) / cap) if cap else (3.0 if c["queued"] else 0.0)
        QG = 1 + max(0, qnow[k] - prev.get(k, qnow[k])) / max(1, cap)
        B = U * DP * QG
        n_wait = max(1, len(h.waiting()))
        c.update(utilization=round(U, 3), demand_pressure=round(DP, 3), queue_growth=round(QG, 3), score=round(B, 3),
                 queue_delta=qnow[k] - prev.get(k, qnow[k]), n_blocked=len(c["blocked"]),
                 delay_minutes=round(c["delay"], 1), avg_wait_contribution=round(c["delay"] / n_wait, 2),
                 is_bottleneck=bool(B >= cfg.bottleneck_threshold and c["blocked"]))
        out.append(c)
    out.sort(key=lambda c: (c["is_bottleneck"], c["score"], c["delay_minutes"]), reverse=True)
    hot = [c for c in out if c["is_bottleneck"]]
    res = dict(t=now, classes=out[:14], primary=hot[0] if hot else None, secondary=hot[1] if len(hot) > 1 else None,
               peak_score=max([c["score"] for c in out if c["n_blocked"] >= 2], default=0.0), queue=qnow)
    for c in ([res["primary"]] if res["primary"] else []) + ([res["secondary"]] if res["secondary"] else []):
        c["cause"] = _cause(c, out, cfg)
    return res


def _cause(c, all_classes, cfg):
    s = (f"{c['busy']}/{c['capacity']} units busy ({c['utilization']:.0%}); {c['queued']} unit(s) demanded by waiting patients "
         f"(demand/capacity {c['demand_pressure']:.2f}); queue {c['queue_delta']:+d} in the last {cfg.growth_window} min; "
         f"{c['n_blocked']} patient(s) delayed by this resource ({c['delay_minutes']:.0f} patient-min)")
    if c["key"].startswith("nurse@"):
        idle = [x for x in all_classes if x["key"].startswith("nurse@") and x["key"] != c["key"] and x["capacity"] and x["utilization"] < 0.5]
        if idle:
            s += "; idle nursing capacity elsewhere: " + ", ".join(f"{x['key'][6:]} ({x['utilization']:.0%})" for x in idle[:3])
    return s


# ------------------------------------------------------------------ interventions
def apply_action(h, a, now):
    """Mutate hospital `h` (clone or live) for an intervention. Returns the affected object id."""
    t = a["type"]
    if t == "move_nurse":
        n = h.nurses[a["id"]]
        tr = travel(n.location, a["zone"])
        n.relocated_from = n.relocated_from or n.home_zone
        n.covered_zones, n.home_zone, n.target_zone = [a["zone"]], a["zone"], a["zone"]
        if tr > 0:
            n.status, n.busy_until = "travelling", now + tr
        else:
            n.location = a["zone"]
        return n.id
    if t == "activate_staff":
        s = h.staff(a["id"])
        s.status, s.on_call = "available", s.on_call
        s.unavailable_reason = ""
        if not s.on_call and s.shift_start > now:
            s.shift_start = now
        return s.id
    if t == "open_bed":
        nid = f"T{sum(1 for b in h.beds.values() if b.temporary) + 1:02d}"
        while nid in h.beds:
            nid += "x"
        h.beds[nid] = Bed(nid, a["zone"], a["bed_type"], f"Temporary {a['bed_type']} ({a['zone']})", temporary=True)
        return nid
    if t == "add_equipment":
        uid = f"TMP-{a['kind'][:3].upper()}{sum(1 for u in h.equipment.values() if u.temporary) + 1}"
        h.equipment[uid] = EquipmentUnit(uid, a["kind"], temporary=True)
        return uid
    raise ValueError(f"unknown action {t}")


def _metrics(h, plan, now, cfg):
    waits, crit = [], []
    items = plan.by_patient()
    for p in h.waiting():
        it = items.get(p.id)
        w = (it.start_time if it else now + cfg.horizon) - p.arrival_time
        waits.append(w)
        if p.urgency >= 6:
            crit.append(w)
    return dict(avg_wait=sum(waits) / len(waits) if waits else 0.0, crit_wait=sum(crit) / len(crit) if crit else 0.0,
                unscheduled=len(plan.unscheduled), J=plan.J["total"], n=len(waits))


def evaluate(h, strategy, predictor, cfg, mode, action, now):
    hc = h.clone_for_planning()
    hc.now = now
    if action is not None:
        apply_action(hc, action, now)
    st = dict(strategy, local_search=False)
    plan = Planner(hc, cfg, st, predictor, mode).plan(now)
    return _metrics(hc, plan, now, cfg)


def recommend(h, analysis, strategy, predictor, cfg, mode, now, temp_beds):
    prim = analysis.get("primary") if analysis else None
    if not prim:
        return []
    key = prim["key"]
    cands = []
    waiting = h.waiting()
    if key.startswith("nurse@"):
        z = key[6:]
        need = [set(p.required_nurse_skills) for p in waiting if p.id in prim["blocked"]] or [set()]
        for n in h.nurses.values():
            if n.status == "available" and z not in n.covered_zones and any(r <= set(n.skills) for r in need):
                cands.append(dict(type="move_nurse", id=n.id, zone=z, from_zone=n.home_zone))
        for n in h.nurses.values():
            if n.status == "off_shift" and z in n.covered_zones and (n.on_call or n.shift_start > now) and any(r <= set(n.skills) for r in need):
                cands.append(dict(type="activate_staff", id=n.id, zone=z))
    elif key.startswith("doctor:"):
        sk = key[7:]
        for d in h.doctors.values():
            if d.status == "off_shift" and sk in d.skills and (d.on_call or d.shift_start > now):
                cands.append(dict(type="activate_staff", id=d.id, zone=d.home_zone))
    elif key.startswith("bed:") and temp_beds < cfg.max_temp_beds:
        t = key[4:]
        zone = {"emergency": "EMERGENCY", "icu": "ICU", "monitored": "WARD_B", "general": "WARD_A", "operating_room": "OR"}[t]
        cands.append(dict(type="open_bed", bed_type=t, zone=zone))
    elif key.startswith("equip:"):
        cands.append(dict(type="add_equipment", kind=key[6:]))
    if not cands:
        return []
    base = evaluate(h, strategy, predictor, cfg, mode, None, now)
    recs = []
    for a in cands[:8]:
        m = evaluate(h, strategy, predictor, cfg, mode, a, now)
        gain, cgain = base["avg_wait"] - m["avg_wait"], base["crit_wait"] - m["crit_wait"]
        if gain >= cfg.reco_min_gain or cgain >= cfg.reco_min_gain or m["unscheduled"] < base["unscheduled"]:
            recs.append(dict(action=a, impact=dict(avg_wait_before=round(base["avg_wait"], 1), avg_wait_after=round(m["avg_wait"], 1),
                                                   avg_wait_gain=round(gain, 1), critical_wait_before=round(base["crit_wait"], 1),
                                                   critical_wait_after=round(m["crit_wait"], 1), critical_wait_gain=round(cgain, 1),
                                                   unscheduled_before=base["unscheduled"], unscheduled_after=m["unscheduled"],
                                                   objective_before=base["J"], objective_after=m["J"]),
                             title=_title(h, a), why=_why(h, a, prim, analysis, now), bottleneck=key))
    recs.sort(key=lambda r: (-r["impact"]["avg_wait_gain"], -r["impact"]["critical_wait_gain"], r["action"].get("id", "")))
    for i, r in enumerate(recs[:3]):
        r["rank"] = i + 1
    return recs[:3]


def _title(h, a):
    t = a["type"]
    if t == "move_nurse":
        n = h.nurses[a["id"]]
        return f"Move nurse {n.id} ({n.name}) from {a['from_zone']} to {a['zone']}"
    if t == "activate_staff":
        s = h.staff(a["id"])
        return f"Call in {s.role} {s.id} ({s.name}) - {s.shift_label}"
    if t == "open_bed":
        return f"Open a temporary {a['bed_type']} bed in {a['zone']}"
    return f"Borrow one extra {a['kind'].replace('_', ' ')} unit"


def _why(h, a, prim, analysis, now):
    why = [f"Bottleneck: {prim['label']} - {prim['cause']}"]
    cl = {c["key"]: c for c in analysis["classes"]}
    if a["type"] == "move_nurse":
        n = h.nurses[a["id"]]
        src = cl.get(f"nurse@{a['from_zone']}")
        why.append(f"{n.id} is idle and holds skills {n.skills}, so it is qualified for the blocked patients")
        if src:
            why.append(f"Source zone {a['from_zone']} utilisation is {src['utilization']:.0%} with {src['queued']} queued unit(s)")
        why.append(f"Estimated relocation time: {travel(n.location, a['zone'])} min (travel cost is low)")
    elif a["type"] == "activate_staff":
        s = h.staff(a["id"])
        why.append(f"{s.name} is off shift / on call with matching skills {s.skills}; calling in adds a qualified unit")
    return why

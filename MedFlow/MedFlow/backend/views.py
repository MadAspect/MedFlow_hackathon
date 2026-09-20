"""Read-models for the role dashboards (nurse / doctor / head nurse) built from engine state."""
from __future__ import annotations
from .engine import clock, BUSY
from .hospital import ZONES, travel
from .models import ACTIVE

TASK = {"CRITICAL": "Stabilisation and continuous monitoring", "HIGH": "Assessment support and medication",
        "MEDIUM": "Monitoring and medication", "LOW": "Vital check and minor care"}


def _pt(e, p):
    return dict(id=p.id, name=p.name, urgency=p.urgency, category=p.risk_category if p.risk_category else "", diagnosis=p.initial_diagnosis)


def _bed_label(e, bid):
    b = e.h.beds.get(bid)
    return f"{ZONES[b.zone]['label'].split(' (')[0]} - Bed {b.id}" if b else "-"


def _current(e, s):
    p = e.h.patients.get(s.current_patient) if s.current_patient else None
    if not p:
        if s.status == "travelling" and s.target_zone:
            return dict(kind="relocation", location=ZONES[s.target_zone]["label"], task=f"Relocating to {s.target_zone}", due="NOW",
                        action=f"Proceed to {ZONES[s.target_zone]['label']} ({max(0, (s.busy_until or e.now) - e.now)} min)")
        return None
    bed = e.h.beds[p.current_bed]
    eta = max(0, (p.pred_end or e.now) - e.now)
    if p.status == "assigned":
        task = "Proceed to bed / prepare"
        action = f"Go to {_bed_label(e, bed.id)} - treatment starts in {max(0, p.start_time - e.now)} min"
    else:
        task = TASK.get(p.risk_category, "Treatment") if s.role == "nurse" else f"Treatment: {p.initial_diagnosis}"
        action = f"Treatment in progress; expected completion in about {eta} min" + (" (overrunning - estimate extended)" if p.overrun_flagged else "")
    return dict(kind="patient", patient=_pt(e, p), location=_bed_label(e, bed.id), bed=bed.id, zone=bed.zone, task=task, due="NOW", eta=eta,
                status=p.status, action=action, expected_completion=clock(p.pred_end) if p.pred_end else None,
                assessment=dict(symptoms=p.symptoms, risk=p.risk_category, diagnosis=p.initial_diagnosis, bed_type=p.bed_type_required,
                                equipment=list(p.equipment_required), department=p.department), overrun=p.overrun_flagged)


def _upcoming(e, s):
    out = []
    if not e.plan:
        return out
    for it in e.plan.items:
        if it.doctor_id == s.id or s.id in it.nurse_ids:
            p = e.h.patients.get(it.patient_id)
            if not p or p.status != "waiting":
                continue
            out.append(dict(patient=_pt(e, p), location=_bed_label(e, it.bed_id), bed=it.bed_id, zone=e.h.beds[it.bed_id].zone,
                            task="Preparation" if s.role == "nurse" else "Treatment / review",
                            due_in=max(0, it.dispatch_time - e.now), start_in=max(0, it.start_time - e.now), due_clock=clock(it.dispatch_time),
                            wait_so_far=round(p.wait_so_far(e.now), 1), planned_duration=it.duration))
    out.sort(key=lambda x: (x["due_in"], -x["patient"]["urgency"]))
    return out


def staff_view(e, sid):
    s = e.h.staff(sid)
    if s is None:
        return None
    cur, up = _current(e, s), _upcoming(e, s)
    alerts = [dict(level=n["level"], text=n["text"], clock=clock(n["t"])) for n in reversed(s.notifications[-8:])]
    if e.emergency.state in ("EMERGENCY", "WARNING"):
        alerts.insert(0, dict(level="critical" if e.emergency.state == "EMERGENCY" else "warning", text=f"Hospital {e.emergency.state} MODE: {e.emergency.trigger}", clock=clock(e.now)))
    if s.status == "unavailable":
        alerts.insert(0, dict(level="warning", text=f"You are marked unavailable: {s.unavailable_reason}", clock=""))
    patients = ([cur["patient"]] if cur and cur["kind"] == "patient" else []) + [u["patient"] for u in up]
    d = dict(id=s.id, name=s.name, role=s.role, specialty=s.specialty, skills=s.skills, shift=s.shift_label, status=s.status, location=ZONES.get(s.location, {}).get("label", s.location),
             zone=s.location, home_zone=s.home_zone, covered_zones=s.covered_zones, current=cur, next=up[0] if up else None, then=up[1] if len(up) > 1 else None,
             upcoming=up[:6], patients=patients, alerts=alerts, workload=dict(assignments=s.assignments, treat_minutes=round(s.treat_minutes), travel_minutes=round(s.travel_minutes),
                                                                              idle_minutes=round(s.idle_minutes)),
             mode=e.emergency.state, clock=clock(e.now), now=e.now)
    if cur is None and s.status == "available":
        d["standby"] = f"Available at {d['location']} - awaiting next assignment from the optimizer"
    return d


def map_view(e):
    h = e.h
    zones = {}
    for z, meta in ZONES.items():
        zones[z] = dict(id=z, label=meta["label"], kind=meta["kind"], beds=[])
    for b in sorted(h.beds.values(), key=lambda b: b.id):
        d = b.to_dict()
        p = h.patients.get(b.patient_id) if b.patient_id else None
        if p:
            d["patient"] = dict(id=p.id, name=p.name, urgency=p.urgency, category=p.risk_category, diagnosis=p.initial_diagnosis, status=p.status,
                                treatment=p.initial_diagnosis, expected_completion=clock(p.pred_end) if p.pred_end else None, age=p.age)
            d["doctor"] = h.doctors[p.assigned_doctor].name if p.assigned_doctor else None
            d["nurses"] = [h.nurses[n].name for n in p.assigned_nurses]
        d["cleaning_until_clock"] = clock(b.cleaning_until) if b.cleaning_until else None
        zones[b.zone]["beds"].append(d)
    staff = {z: [] for z in ZONES}
    for s in h.all_staff():
        if s.status not in ("off_shift",):
            staff.setdefault(s.location, []).append(dict(id=s.id, name=s.name, role=s.role, status=s.status))
    for z in zones:
        zones[z]["staff"] = staff.get(z, [])
    waiting = [dict(id=p.id, name=p.name, urgency=p.urgency, category=p.risk_category, wait=round(p.wait_so_far(e.now), 1), bed_type=p.bed_type_required,
                    diagnosis=p.initial_diagnosis) for p in sorted(h.waiting(), key=lambda p: -(p.priority or {}).get("S", 0))]
    return dict(zones=list(zones.values()), waiting=waiting, clock=clock(e.now))


def patient_row(e, p):
    d = p.to_dict()
    h = e.h
    d.pop("timeline", None)
    d["doctor_name"] = h.doctors[p.assigned_doctor].name if p.assigned_doctor else None
    d["nurse_names"] = [h.nurses[n].name for n in p.assigned_nurses]
    d["wait_now"] = round(p.wait_so_far(e.now), 1)
    d["time_to_treatment"] = round(p.wait_at_first_start(e.now), 1) if p.first_start_time is not None else None
    d["location"] = _bed_label(e, p.current_bed) if p.current_bed else ("Waiting area" if p.status == "waiting" else "-")
    d["expected_completion"] = clock(p.pred_end) if p.pred_end and p.status in ACTIVE else None
    d["planned_start_in"] = max(0, p.planned_start - e.now) if p.planned_start is not None else None
    d["planned_start_clock"] = clock(p.planned_start) if p.planned_start is not None else None
    d["arrival_clock"] = clock(p.arrival_time)
    return d


def patients_view(e, status=None):
    ps = list(e.h.patients.values())
    if status:
        ps = [p for p in ps if p.status in status.split(",")]
    order = {"in_treatment": 0, "assigned": 1, "waiting": 2, "completed": 3, "transferred": 4}
    ps.sort(key=lambda p: (order.get(p.status, 9), -(p.priority or {}).get("S", 0), p.arrival_time) if p.status == "waiting" else (order.get(p.status, 9), -p.arrival_time))
    return [patient_row(e, p) for p in ps]


def assignments_view(e):
    act = []
    for p in e.h.active():
        act.append(dict(patient_id=p.id, patient=p.name, status=p.status, bed=p.current_bed, doctor=p.assigned_doctor, nurses=p.assigned_nurses,
                        start=clock(p.start_time), expected_end=clock(p.pred_end), overrun=p.overrun_flagged))
    plan = []
    if e.plan:
        for it in e.plan.items[:30]:
            plan.append(dict(patient_id=it.patient_id, bed=it.bed_id, doctor=it.doctor_id, nurses=it.nurse_ids, dispatch_in=it.dispatch_time - e.now,
                             start=clock(it.start_time), expected_end=clock(it.end_time), binding=it.binding, cost=it.cost, travel=it.travel))
    return dict(active=act, planned=plan, unscheduled=e.plan.unscheduled[:30] if e.plan else [], recent=e.assignments_log[-25:][::-1])


def staff_rows(e, role):
    pool = e.h.doctors if role == "doctor" else e.h.nurses
    out = []
    for s in pool.values():
        d = s.to_dict()
        p = e.h.patients.get(s.current_patient) if s.current_patient else None
        d["current_patient_name"] = p.name if p else None
        d["notifications"] = d["notifications"][-3:]
        out.append(d)
    return out

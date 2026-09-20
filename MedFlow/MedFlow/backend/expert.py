"""Initial-triage decision support (rule-based expert system).

NOT a diagnostic system.  It converts reported symptoms / vitals into
  * a risk score C in [0,1]  (noisy-OR:  C = 1 - prod_i (1 - s_i))
  * a suggested urgency, department, specialty, bed type and staffing pathway
that feed the priority engine and the optimizer.  Weights are prototype
parameters, not validated clinical values; the interface (`evaluate`) is what a
validated clinical model would later replace.
"""
from __future__ import annotations
from .config import urgency_category, Config

DISCLAIMER = ("Decision-support / initial triage assistance for an operations prototype. "
              "Not a medical diagnosis; not clinically validated. A clinician must confirm triage.")

# symptom -> (weight s_i, clinical group)
SYMPTOMS = {
    "cardiac arrest": (0.95, "cardiac"), "chest pain": (0.55, "cardiac"), "high heart rate": (0.30, "cardiac"),
    "shortness of breath": (0.45, "respiratory"), "low oxygen saturation": (0.60, "respiratory"),
    "slurred speech": (0.65, "neuro"), "facial droop": (0.65, "neuro"), "sudden weakness": (0.55, "neuro"),
    "seizure": (0.60, "neuro"), "loss of consciousness": (0.70, "neuro"),
    "severe bleeding": (0.75, "bleeding"), "major trauma": (0.70, "trauma"),
    "allergic reaction": (0.60, "allergic"), "anaphylaxis": (0.80, "allergic"),
    "fracture": (0.35, "ortho"), "open fracture": (0.55, "ortho_surgical"),
    "abdominal pain": (0.30, "abdominal"), "vomiting": (0.12, "abdominal"),
    "fever": (0.15, "infectious"), "cough": (0.10, "infectious"),
    "headache": (0.12, "general"), "dizziness": (0.15, "general"),
    "minor cut": (0.05, "minor"), "sprain": (0.08, "minor"), "rash": (0.05, "minor"),
}
SYNONYMS = {"breathlessness": "shortness of breath", "sob": "shortness of breath", "tachycardia": "high heart rate",
            "fast heart rate": "high heart rate", "unconscious": "loss of consciousness", "stroke symptoms": "slurred speech",
            "bleeding": "severe bleeding", "trauma": "major trauma", "low spo2": "low oxygen saturation",
            "broken bone": "fracture", "stomach pain": "abdominal pain", "high fever": "fever"}
GROUP_SPECIALTY = {"cardiac": "Cardiology", "respiratory": "Pulmonology / Critical Care", "neuro": "Neurology",
                   "bleeding": "Surgery", "trauma": "Emergency Medicine", "allergic": "Emergency Medicine",
                   "ortho": "Orthopedics", "ortho_surgical": "Orthopedics", "abdominal": "General Medicine",
                   "infectious": "General Medicine", "general": "General Medicine", "minor": "General Medicine"}
CONSUMPTION_MEAN = {
    "CRITICAL": dict(iv_sets=3, oxygen_masks=1.5, syringes=9, gloves=24, saline_bags=3, ecg_electrodes=6),
    "HIGH": dict(iv_sets=2, oxygen_masks=1, syringes=6, gloves=16, saline_bags=2, ecg_electrodes=4),
    "MEDIUM": dict(iv_sets=1, oxygen_masks=.4, syringes=3, gloves=8, saline_bags=1, ecg_electrodes=2),
    "LOW": dict(iv_sets=.3, oxygen_masks=.1, syringes=1, gloves=4, saline_bags=.3, ecg_electrodes=.5),
}
BASE_DURATION = {"CRITICAL": 60, "HIGH": 38, "MEDIUM": 30, "LOW": 16}


def _norm(sym: str) -> str:
    s = sym.strip().lower()
    return SYNONYMS.get(s, s)


def _vital_flags(v: dict, age: int):
    """(s_i, text) contributions from vital signs / age."""
    out = []
    spo2, hr, sbp, rr = v.get("spo2"), v.get("heart_rate"), v.get("systolic_bp"), v.get("resp_rate")
    if spo2 is not None:
        if spo2 < 90: out.append((0.60, f"SpO2 {spo2}% (<90)"))
        elif spo2 < 94: out.append((0.25, f"SpO2 {spo2}% (<94)"))
    if hr is not None:
        if hr > 130: out.append((0.35, f"heart rate {hr} (>130)"))
        elif hr > 110: out.append((0.20, f"heart rate {hr} (>110)"))
        elif hr < 45: out.append((0.40, f"heart rate {hr} (<45)"))
    if sbp is not None:
        if sbp < 90: out.append((0.50, f"systolic BP {sbp} (<90)"))
        elif sbp > 180: out.append((0.25, f"systolic BP {sbp} (>180)"))
    if rr is not None and rr > 28:
        out.append((0.35, f"respiratory rate {rr} (>28)"))
    if age >= 75: out.append((0.10, f"age {age} (>=75)"))
    elif age >= 65: out.append((0.05, f"age {age} (>=65)"))
    return out


def _pathway(group, category, symptoms):
    """Operational pathway (bed / doctor / nurse requirements) for group x category."""
    base = BASE_DURATION[category]
    P = dict(department="General Medicine", specialty="general", bed="general", skills=["ward"], nurses=1, equip={}, dur=base)
    if category == "CRITICAL":
        if group in ("cardiac", "respiratory", "neuro"):
            P.update(department="ICU", specialty="critical_care", bed="icu", skills=["icu"], nurses=2, dur=base)
            if group == "cardiac": P["equip"] = {"cardiac_monitor": 1}
            if group == "respiratory": P["equip"] = {"ventilator": 1}
        elif group in ("bleeding", "ortho_surgical"):
            P.update(department="Surgery", specialty="surgery", bed="operating_room", skills=["theatre"], nurses=2, dur=base + 15)
        else:
            P.update(department="Emergency", specialty="emergency", bed="emergency", skills=["emergency"], nurses=2, dur=base - 5)
    elif category == "HIGH":
        if group == "ortho_surgical":
            P.update(department="Surgery", specialty="surgery", bed="operating_room", skills=["theatre"], nurses=2, dur=base + 25)
        elif group == "ortho":
            P.update(department="Orthopedics", specialty="orthopedics", bed="general", dur=base + 7)
        else:
            P.update(department="Emergency", specialty="emergency", bed="emergency", skills=["emergency"], nurses=1, dur=base)
            if group == "cardiac": P["equip"] = {"cardiac_monitor": 1}
    elif category == "MEDIUM":
        if group == "cardiac":
            P.update(department="Cardiology", specialty="cardiology", bed="monitored", equip={"cardiac_monitor": 1}, dur=base + 8)
        elif group == "neuro":
            P.update(department="Neurology", specialty="neurology", bed="monitored", dur=base + 8)
        elif group in ("ortho", "ortho_surgical"):
            P.update(department="Orthopedics", specialty="orthopedics", bed="general", dur=base + 8)
        else:
            P.update(dur=base)
    else:
        P.update(dur=base if group != "minor" else base - 4)
    return P


def evaluate(symptoms, vitals=None, age=40, cfg: Config | None = None):
    """Return triage decision-support output for one patient (see module docstring)."""
    cfg = cfg or Config()
    vitals = vitals or {}
    syms = [_norm(s) for s in symptoms]
    known = [s for s in syms if s in SYMPTOMS]
    unknown = [s for s in syms if s not in SYMPTOMS]
    contrib = [(SYMPTOMS[s][0], f"symptom '{s}'") for s in known]
    contrib += _vital_flags(vitals, age)
    ks = set(known)
    flags = []
    if {"chest pain", "shortness of breath", "high heart rate"} <= ks:
        contrib.append((0.10, "pattern: chest pain + dyspnoea + tachycardia")); flags.append("possible acute cardiac pattern")
    if {"slurred speech", "facial droop"} <= ks:
        contrib.append((0.10, "pattern: speech + facial deficit")); flags.append("possible acute neurological pattern")
    prod = 1.0
    for s, _ in contrib:
        prod *= (1 - s)
    C = round(min(0.98, 1 - prod), 3)
    urgency = max(1, min(10, round(1 + 9 * C)))
    category = urgency_category(urgency)
    group = max(known, key=lambda s: SYMPTOMS[s][0]) if known else None
    grp = SYMPTOMS[group][1] if group else "general"
    # a low-weight complaint with abnormal vitals is still triaged by vitals; pathway uses the primary complaint group
    P = _pathway(grp, category, ks)
    suggested_spec = GROUP_SPECIALTY.get(grp, "General Medicine")
    dept_hint = (f"Emergency / {suggested_spec}" if category in ("CRITICAL", "HIGH") and suggested_spec not in ("Emergency Medicine",)
                 else P["department"])
    return {
        "risk_category": category, "risk_score": C, "urgency": urgency,
        "suggested_department": dept_hint, "suggested_specialty": suggested_spec,
        "department": P["department"], "required_specialty": P["specialty"], "bed_type": P["bed"],
        "nurse_skills": P["skills"], "nurses_required": P["nurses"], "equipment": P["equip"],
        "nominal_duration": int(P["dur"]),
        "priority_uplift_points": round(100 * cfg.weights_normal["c"] * C),
        "primary_complaint": group, "flags": flags, "unrecognised_symptoms": unknown,
        "rationale": [f"{t}: +{s:.2f}" for s, t in contrib],
        "disclaimer": DISCLAIMER,
    }


def diagnosis_text(symptoms, ev):
    """Short 'initial assessment' string (decision-support wording, not a diagnosis)."""
    if ev["flags"]:
        return "Suspected " + ev["flags"][0].replace("possible ", "")
    return ", ".join(symptoms[:2]).capitalize() if symptoms else "Unspecified complaint"

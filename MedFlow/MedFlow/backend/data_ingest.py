"""External dataset ingestion:  CSV -> validation -> normalisation -> MedFlow patient schema -> simulation.

Works offline: if no file is given a bundled SYNTHETIC sample (data/sample_ed_visits.csv, generated
deterministically) is used.  This sandbox had no network access, so no real public dataset is bundled;
point `load_csv(path, mapping)` at a downloaded ED-triage CSV (e.g. from Kaggle - check its licence) and
map its column names if they differ from DEFAULT_MAPPING.

Field provenance (also returned by `provenance()`):
  from the dataset : age, sex, chief complaint text, vital signs, triage level (if the columns exist)
  expert-derived   : symptoms (keyword match), risk score, department, specialty, bed/nurse/equipment needs
  assumed          : nominal treatment minutes per pathway
  simulated        : arrival times (Poisson), actual treatment duration (log-normal), deterioration hazard, consumables
"""
from __future__ import annotations
import csv, os, random
from . import expert
from . import scenarios as scn

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
SAMPLE = os.path.join(DATA_DIR, "sample_ed_visits.csv")
DEFAULT_MAPPING = {
    "age": ["age", "Age"], "sex": ["sex", "gender", "Gender"], "complaint": ["chief_complaint", "complaint", "Chief Complaint", "reason"],
    "heart_rate": ["heart_rate", "hr", "Heart Rate"], "spo2": ["spo2", "o2_sat", "SpO2"], "systolic_bp": ["systolic_bp", "sbp", "Systolic BP"],
    "resp_rate": ["resp_rate", "rr", "Respiratory Rate"], "triage": ["triage_level", "esi", "ESI", "triage"],
}
KEYWORDS = [("cardiac arrest", "cardiac arrest"), ("chest pain", "chest pain"), ("short", "shortness of breath"), ("breath", "shortness of breath"),
            ("stroke", "slurred speech"), ("slurred", "slurred speech"), ("droop", "facial droop"), ("seizure", "seizure"), ("unconscious", "loss of consciousness"),
            ("bleed", "severe bleeding"), ("trauma", "major trauma"), ("accident", "major trauma"), ("allerg", "allergic reaction"), ("open fracture", "open fracture"),
            ("fracture", "fracture"), ("broken", "fracture"), ("abdominal", "abdominal pain"), ("stomach", "abdominal pain"), ("vomit", "vomiting"), ("fever", "fever"),
            ("cough", "cough"), ("headache", "headache"), ("dizz", "dizziness"), ("cut", "minor cut"), ("sprain", "sprain"), ("rash", "rash")]
ESI_TO_URGENCY = {1: 10, 2: 8, 3: 5, 4: 3, 5: 1}


def provenance():
    return dict(from_dataset=["age", "sex", "chief_complaint", "vital signs", "triage level (if present)"],
                expert_derived=["symptoms", "risk score", "department", "required specialty", "bed / nurse / equipment needs", "urgency (if no triage level)"],
                assumed=["nominal treatment minutes per pathway"],
                simulated=["arrival times", "actual treatment duration", "deterioration hazard", "consumables used"])


def ensure_sample():
    if os.path.exists(SAMPLE):
        return SAMPLE
    os.makedirs(DATA_DIR, exist_ok=True)
    rng = random.Random(2024)
    with open(SAMPLE, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["age", "sex", "chief_complaint", "heart_rate", "spo2", "systolic_bp", "resp_rate", "triage_level"])
        for _ in range(400):
            label, syms, vr, ar, wn, _ws = rng.choices(scn.T, weights=[t[4] for t in scn.T])[0]
            age = rng.randint(*ar)
            v = {k: (round(rng.uniform(*x)) if isinstance(x[0], int) else round(rng.uniform(*x), 1)) for k, x in vr.items()}
            ev = expert.evaluate(syms, v, age)
            esi = 1 if ev["urgency"] >= 9 else 2 if ev["urgency"] >= 7 else 3 if ev["urgency"] >= 5 else 4 if ev["urgency"] >= 3 else 5
            w.writerow([age, rng.choice("MF"), label.lower(), v.get("heart_rate", ""), v.get("spo2", ""), v.get("systolic_bp", ""), v.get("resp_rate", ""), esi])
    return SAMPLE


def _pick(row, names):
    for n in names:
        if n in row and row[n] not in ("", None):
            return row[n]
    return None


def load_csv(path=None, mapping=None):
    """Return (rows, report).  Rows are normalised dicts; invalid rows are dropped and counted."""
    path = path or ensure_sample()
    mp = dict(DEFAULT_MAPPING, **(mapping or {}))
    rows, bad, reasons = [], 0, {}
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            try:
                age = int(float(_pick(r, mp["age"]) or "nan"))
                complaint = (_pick(r, mp["complaint"]) or "").strip().lower()
                if not (0 <= age <= 120) or not complaint:
                    raise ValueError("age/complaint invalid")
                vit = {}
                for k in ("heart_rate", "spo2", "systolic_bp", "resp_rate"):
                    v = _pick(r, mp[k])
                    if v is not None:
                        v = float(v)
                        if {"heart_rate": (20, 250), "spo2": (40, 100), "systolic_bp": (40, 300), "resp_rate": (4, 70)}[k][0] <= v <= {"heart_rate": (20, 250), "spo2": (40, 100), "systolic_bp": (40, 300), "resp_rate": (4, 70)}[k][1]:
                            vit[k] = round(v)
                tri = _pick(r, mp["triage"])
                rows.append(dict(age=age, sex=(_pick(r, mp["sex"]) or "U")[:1].upper(), complaint=complaint, vitals=vit,
                                 triage=int(float(tri)) if tri is not None and int(float(tri)) in ESI_TO_URGENCY else None))
            except Exception as ex:
                bad += 1
                reasons[str(ex)[:40]] = reasons.get(str(ex)[:40], 0) + 1
    return rows, dict(path=path, accepted=len(rows), rejected=bad, reject_reasons=reasons, provenance=provenance())


def symptoms_from_text(text):
    out = []
    for kw, sym in KEYWORDS:
        if kw in text and sym not in out:
            out.append(sym)
    return out or ["headache"]


def patient_from_row(row, index, arrival, seed, cfg, name=None):
    rng = random.Random(seed * 100003 + index)
    syms = symptoms_from_text(row["complaint"])
    ev = expert.evaluate(syms, row["vitals"], row["age"], cfg)
    if row.get("triage"):
        u = ESI_TO_URGENCY[row["triage"]]
        cat = scn.urgency_category(u)
        grp = expert.SYMPTOMS[ev["primary_complaint"] and max(syms, key=lambda s: expert.SYMPTOMS[s][0])][1] if syms else "general"
        P = expert._pathway(grp, cat, set(syms))
        ev.update(urgency=u, risk_category=cat, risk_score=max(ev["risk_score"], (u - 1) / 9 * 0.95), department=P["department"],
                  required_specialty=P["specialty"], bed_type=P["bed"], nurse_skills=P["skills"], nurses_required=P["nurses"], equipment=P["equip"],
                  nominal_duration=int(P["dur"]))
    nm = name or f"{rng.choice(scn.FIRST)} {rng.choice(scn.LAST)}"
    p = scn.patient_from_expert(f"P{index:03d}", nm, arrival, row["age"], syms, row["vitals"], ev, rng, cfg, "dataset", row["complaint"].capitalize())
    p.sex = row["sex"]
    return p

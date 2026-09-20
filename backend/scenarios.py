"""Scenario presets and the synthetic patient generator.

Arrivals: non-homogeneous Poisson process from a piecewise rate profile (seeded => reproducible
and identical across strategies).  Each patient's attributes come from a complaint template ->
expert system -> pathway; operational fields (durations, hazards) are SIMULATED, see docs/DATA.md.
"""
from __future__ import annotations
import math, random
from .models import Patient
from .config import urgency_category
from . import expert

FIRST = ["Aarav", "Vivaan", "Aditya", "Rohan", "Karthik", "Ravi", "Suresh", "Manoj", "Arun", "Vijay", "Ananya", "Diya", "Isha", "Kavya",
         "Lakshmi", "Meena", "Nisha", "Pooja", "Rekha", "Sneha", "Farhan", "Imran", "Zainab", "Ayesha", "Joseph", "Mary", "Thomas", "Gurpreet", "Harish", "Shweta"]
LAST = ["Kumar", "Reddy", "Nair", "Gowda", "Shetty", "Rao", "Iyer", "Sharma", "Patel", "Singh", "Khan", "Menon", "Hegde", "Naik", "Joshi", "Bhat", "D'Souza", "Pillai", "Das", "Verma"]

# (label, symptoms, vitals ranges, age range, weight normal, weight surge)
T = [
    ("Chest pain / cardiac", ["chest pain", "shortness of breath", "high heart rate"], dict(heart_rate=(105, 135), spo2=(90, 97), systolic_bp=(95, 160)), (45, 82), 1.5, 4),
    ("Cardiac arrest", ["cardiac arrest"], dict(), (40, 85), 0.2, 1),
    ("Stroke symptoms", ["slurred speech", "facial droop", "sudden weakness"], dict(systolic_bp=(140, 200)), (50, 85), 0.8, 2),
    ("Major trauma (RTA)", ["major trauma", "severe bleeding"], dict(heart_rate=(110, 140), systolic_bp=(70, 100)), (18, 60), 0.5, 2),
    ("Trauma, stable", ["major trauma"], dict(heart_rate=(80, 110)), (18, 60), 4, 10),
    ("Respiratory distress", ["shortness of breath", "low oxygen saturation", "cough"], dict(spo2=(84, 92), resp_rate=(22, 34)), (30, 80), 3, 3),
    ("Allergic reaction", ["allergic reaction"], dict(), (5, 60), 3, 4),
    ("Fracture", ["fracture"], dict(), (8, 75), 9, 4),
    ("Open fracture", ["open fracture", "fracture"], dict(), (15, 65), 1.2, 1),
    ("Abdominal pain", ["abdominal pain", "vomiting"], dict(), (15, 70), 11, 5),
    ("Fever and cough", ["fever", "cough"], dict(), (5, 80), 17, 3),
    ("Headache / dizziness", ["headache", "dizziness"], dict(), (20, 80), 11, 2),
    ("Minor injury", ["minor cut"], dict(), (5, 70), 18, 3),
    ("Seizure", ["seizure"], dict(), (5, 60), 2, 3),
    ("Chest pain, mild", ["chest pain"], dict(), (40, 75), 6, 6),
]


def poisson(rng, lam):
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


def make_patient(index, arrival, seed, cfg, mix="normal", template=None, name=None, source="generated"):
    rng = random.Random(seed * 100003 + index)
    tw = [t[5] if mix == "surge" else t[4] for t in T]
    tpl = template or rng.choices(T, weights=tw)[0]
    label, syms, vr, ar, _, _ = tpl
    age = rng.randint(*ar)
    vit = {k: (round(rng.uniform(*v)) if isinstance(v[0], int) else round(rng.uniform(*v), 1)) for k, v in vr.items()}
    ev = expert.evaluate(syms, vit, age, cfg)
    return patient_from_expert(f"P{index:03d}", name or f"{rng.choice(FIRST)} {rng.choice(LAST)}", arrival, age, syms, vit, ev, rng, cfg, source,
                               expert.diagnosis_text(syms, ev) if ev["flags"] else label)


def patient_from_expert(pid, name, arrival, age, syms, vit, ev, rng, cfg, source="generated", diagnosis=""):
    cat = ev["risk_category"]
    nominal = ev["nominal_duration"]
    bias = cfg.duration_bias.get(ev["department"], 1.0)
    z = rng.gauss(0, 1)
    sig = cfg.duration_sigma
    actual = nominal * bias * math.exp(sig * z - sig * sig / 2)         # mean-preserving log-normal
    haz = cfg.hazard_per_min[cat]
    cons = {k: max(0, round(v * rng.uniform(.7, 1.3))) for k, v in expert.CONSUMPTION_MEAN[cat].items()}
    p = Patient(pid, name, int(arrival), ev["urgency"], ev["urgency"], age, rng.choice("MF"), list(syms), dict(vit), diagnosis,
                cat, ev["risk_score"], ev["department"], ev["required_specialty"], ev["suggested_specialty"], list(ev["nurse_skills"]),
                ev["nurses_required"], ev["bed_type"], dict(ev["equipment"]), nominal, cons, source)
    p.actual_total = max(3.0, actual)
    p.hazard_draw = rng.expovariate(haz) if haz > 0 else 1e9
    p.latent = z
    p.log(int(arrival), "arrived / triaged")
    return p


def generate_arrivals(profile, duration, seed, cfg, start_index=1, factory=None):
    rng = random.Random(seed)
    out, idx = [], start_index
    for t in range(duration):
        seg = next((s for s in profile if s["start"] <= t < s["end"]), None)
        if not seg:
            continue
        for _ in range(poisson(rng, seg["rate"] / 60.0)):
            out.append((factory or make_patient)(idx, t, seed, cfg, seg.get("mix", "normal")))
            idx += 1
    return out


def generate_surge(now, n, window, critical_frac, seed, start_index, cfg):
    rng = random.Random(seed * 7919 + now)
    out = []
    crit_t = [t for t in T if t[0] in ("Chest pain / cardiac", "Major trauma (RTA)", "Respiratory distress", "Stroke symptoms", "Cardiac arrest")]
    for i in range(n):
        arr = now + 1 + int(i * max(1, window) / max(1, n))
        tpl = rng.choice(crit_t) if rng.random() < critical_frac else None
        out.append(make_patient(start_index + i, arr, seed, cfg, "surge", template=tpl))
    return out


def _prof(rate=6, surge=None):
    prof = [dict(start=0, end=720, rate=rate, mix="normal")]
    if surge:
        s, e, r = surge
        prof = [dict(start=0, end=s, rate=rate, mix="normal"), dict(start=s, end=e, rate=r, mix="surge"),
                dict(start=e, end=720, rate=rate, mix="normal")]
    return prof


SCENARIOS = {
    "demo_day": dict(label="Demo day: surge + overrun + shortage + ICU failure", seed=7, duration=720, baseline=6,
                     description="Normal day (6/h) -> ambulance surge at 11:00 (15/h) -> one treatment overruns -> two ER nurses unavailable -> ICU bed fails.",
                     profile=_prof(6, (180, 240, 15)),
                     events=[dict(t=205, type="overrun", min_expected=30, factor=1.8),
                             dict(t=250, type="staff_unavailable", ids=["N02", "N03"], reason="sick leave"),
                             dict(t=300, type="bed_failure", ids=["I02"], reason="ventilation fault")]),
    "normal_day": dict(label="Normal day (6 patients/hour)", seed=11, duration=720, baseline=6, description="Steady arrivals, no disruptions.",
                       profile=_prof(6), events=[]),
    "surge_test": dict(label="Emergency surge: 5/h -> 15/h", seed=21, duration=720, baseline=5,
                       description="Normal arrivals with a 90-minute surge to 15 patients/hour.", profile=_prof(5, (150, 240, 15)), events=[]),
    "staff_shortage": dict(label="Staff shortage", seed=31, duration=720, baseline=7,
                           description="Three ER/ICU nurses and one ER doctor become unavailable.", profile=_prof(7),
                           events=[dict(t=120, type="staff_unavailable", ids=["N01", "N02", "N16"], reason="unavailable"),
                                   dict(t=150, type="staff_unavailable", ids=["D01"], reason="unavailable")]),
    "sample_dataset_day": dict(label="Day driven by the bundled ED-visit sample dataset", seed=51, duration=720, baseline=7, dataset="sample",
                               description="Patient attributes come from data/sample_ed_visits.csv via the ingestion layer; operational fields are simulated.",
                               profile=_prof(7, (200, 260, 14)), events=[]),
    "icu_failure": dict(label="ICU / equipment failure", seed=41, duration=720, baseline=7,
                        description="Two ICU beds and a ventilator fail mid-day.", profile=_prof(7),
                        events=[dict(t=120, type="bed_failure", ids=["I01", "I02"], reason="equipment fault"),
                                dict(t=130, type="equipment_failure", ids=["VEN1"], reason="failure")]),
}

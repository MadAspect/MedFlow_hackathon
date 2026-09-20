import re
import random

DEFAULT_RESOURCES = {
    "doctor": 5,
    "nurse": 10,
    "bed": 20,
    "icu_bed": 5,
    "operating_room": 2,
}

def parse_scenario(text):
    text = text.strip()
    lower = text.lower()

    count_match = re.search(r"(\d+)\s+(?:high[- ]urgency\s+|urgent\s+|emergency\s+)?patients?", lower)
    patient_count = int(count_match.group(1)) if count_match else 12

    window_match = re.search(r"(?:within|over|during)\s+(\d+)\s*(?:minutes?|mins?)", lower)
    arrival_window = int(window_match.group(1)) if window_match else 30

    if "critical" in lower or "high-urgency" in lower or "high urgency" in lower or "emergency" in lower:
        urgency = 8
    elif "low" in lower:
        urgency = 3
    elif "urgent" in lower:
        urgency = 7
    else:
        urgency = 5

    resources = dict(DEFAULT_RESOURCES)
    if "icu" in lower:
        resources["icu_bed"] = max(resources["icu_bed"], 5)

    rng = random.Random(42)
    patients = []
    for i in range(patient_count):
        arrival = round(i * arrival_window / max(patient_count - 1, 1))
        u = max(1, min(10, urgency + rng.choice([-1, 0, 0, 1])))
        if u >= 8:
            req = {"doctor": 1, "nurse": 2, "icu_bed": 1}
            treatment = rng.randint(35, 60)
        elif u >= 6:
            req = {"doctor": 1, "nurse": 1, "bed": 1}
            treatment = rng.randint(25, 45)
        else:
            req = {"doctor": 1, "nurse": 1, "bed": 1}
            treatment = rng.randint(15, 30)
        patients.append({
            "id": f"P{i+1:03d}",
            "arrival_time": arrival,
            "urgency": u,
            "treatment_time": treatment,
            "required_resources": req
        })

    return {
        "name": text or "Default scenario",
        "patients": patients,
        "resources": resources,
        "parameters": {
            "patient_count": patient_count,
            "urgency": urgency,
            "arrival_window": arrival_window
        },
        "optimize": True
    }

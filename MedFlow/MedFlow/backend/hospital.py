"""Hospital state: layout graph, staff roster, beds, equipment, consumables.

`Hospital` is the single source of truth ("hospital state engine").  It has no
scheduling logic - the planner reads it and the engine mutates it.
"""
from __future__ import annotations
import copy
from .models import (Doctor, Nurse, Bed, EquipmentUnit, Consumable, ACTIVE)

# ------------------------------------------------------------------ layout
ZONES = {
    "HUB":       dict(label="Central corridor", kind="hub"),
    "EMERGENCY": dict(label="Emergency", kind="ward"),
    "ICU":       dict(label="ICU", kind="ward"),
    "WARD_A":    dict(label="Ward A (fast-track / general)", kind="ward"),
    "WARD_B":    dict(label="Ward B (monitored)", kind="ward"),
    "WARD_C":    dict(label="Ward C (ortho / general)", kind="ward"),
    "OR":        dict(label="Operating theatres", kind="ward"),
}
EDGES = [("HUB", "EMERGENCY", 1), ("HUB", "ICU", 2), ("HUB", "WARD_A", 2), ("HUB", "WARD_B", 2),
         ("HUB", "WARD_C", 3), ("HUB", "OR", 3), ("EMERGENCY", "ICU", 2), ("ICU", "OR", 1),
         ("WARD_A", "WARD_B", 1), ("WARD_B", "WARD_C", 1)]
# department -> home zone (preferred ward for that department's beds)
DEPT_ZONE = {"Emergency": "EMERGENCY", "ICU": "ICU", "General Medicine": "WARD_A", "Cardiology": "WARD_B",
             "Neurology": "WARD_B", "Orthopedics": "WARD_C", "Surgery": "OR"}
# which bed types may host a patient that requires a given type (first = primary)
BED_COMPAT = {"icu": ["icu"], "emergency": ["emergency", "monitored"], "monitored": ["monitored", "icu"],
              "general": ["general", "monitored"], "operating_room": ["operating_room"]}
BED_RANK = {"general": 0, "emergency": 1, "monitored": 1, "operating_room": 1, "icu": 2}


def _floyd(zones, edges):
    INF = 10 ** 6
    d = {a: {b: (0 if a == b else INF) for b in zones} for a in zones}
    for a, b, w in edges:
        d[a][b] = d[b][a] = min(d[a][b], w)
    for k in zones:
        for i in zones:
            for j in zones:
                if d[i][k] + d[k][j] < d[i][j]:
                    d[i][j] = d[i][k] + d[k][j]
    return d


DIST = _floyd(list(ZONES), EDGES)
MAXDIST_TO = {z: max(DIST[o][z] for o in ZONES) for z in ZONES}


def travel(a: str, b: str) -> int:
    return DIST.get(a, DIST["HUB"]).get(b, 0)


# ------------------------------------------------------------------ roster
def _doc(i, name, spec, skills, zone, shift="day", on_call=False):
    ss, se, lab = SHIFTS[shift]
    d = Doctor(f"D{i:02d}", name, "doctor", skills=skills, shift_label=lab, shift_start=ss, shift_end=se,
               on_call=on_call, location=zone, home_zone=zone, specialty=spec)
    if on_call or ss > 0:
        d.status = "off_shift"
    return d


def _nur(i, name, zone, skills, shift="day", on_call=False):
    ss, se, lab = SHIFTS[shift]
    n = Nurse(f"N{i:02d}", name, "nurse", skills=skills, shift_label=lab, shift_start=ss, shift_end=se,
              on_call=on_call, location=zone, home_zone=zone, covered_zones=[zone])
    if on_call or ss > 0:
        n.status = "off_shift"
    return n


SHIFTS = {"day": (0, 720, "Day 08:00-20:00"), "mid": (240, 960, "Mid 12:00-24:00"),
          "oncall": (0, 10 ** 6, "On-call")}


def default_doctors():
    return [
        _doc(1, "Dr. Arjun Rao", "Emergency Medicine", ["emergency", "general"], "EMERGENCY"),
        _doc(2, "Dr. Meera Nair", "Emergency Medicine", ["emergency", "general"], "EMERGENCY"),
        _doc(3, "Dr. Sameer Khan", "Emergency Medicine", ["emergency", "general"], "EMERGENCY", "mid"),
        _doc(4, "Dr. Kavita Menon", "Cardiology", ["cardiology"], "WARD_B"),
        _doc(5, "Dr. Rohan Iyer", "Cardiology", ["cardiology"], "WARD_B", "mid"),
        _doc(6, "Dr. Anita Desai", "Critical Care", ["critical_care"], "ICU"),
        _doc(7, "Dr. Vikram Singh", "Critical Care", ["critical_care"], "ICU"),
        _doc(8, "Dr. Suresh Patil", "General Medicine", ["general"], "WARD_A"),
        _doc(9, "Dr. Farah Ali", "General Medicine", ["general"], "WARD_A"),
        _doc(10, "Dr. Nikhil Bhat", "Orthopedics", ["orthopedics", "surgery"], "WARD_C"),
        _doc(11, "Dr. Lakshmi Reddy", "Neurology", ["neurology"], "WARD_B"),
        _doc(12, "Dr. Imran Sheikh", "Emergency Medicine", ["emergency", "general"], "EMERGENCY", "oncall", True),
        _doc(13, "Dr. Pooja Kulkarni", "General Surgery", ["surgery"], "OR"),
        _doc(14, "Dr. Deepak Hegde", "Critical Care", ["critical_care"], "ICU", "mid"),
    ]


def default_nurses():
    W = ["ward"]
    return [
        _nur(1, "Priya Sharma", "EMERGENCY", ["emergency", "ward"]),
        _nur(2, "Anjali Gowda", "EMERGENCY", ["emergency", "ward"]),
        _nur(3, "Rekha Naik", "EMERGENCY", ["emergency", "ward"]),
        _nur(4, "Divya Hegde", "EMERGENCY", ["emergency", "ward"]),
        _nur(5, "Shalini Joshi", "EMERGENCY", ["emergency", "ward"]),
        _nur(6, "Deepa Kamath", "EMERGENCY", ["emergency", "ward"], "mid"),
        _nur(7, "Kiran Bhat", "WARD_C", ["ward", "emergency"]),
        _nur(8, "Lata Shetty", "WARD_C", W),
        _nur(9, "Mamta Pai", "WARD_C", W),
        _nur(10, "Nandini Rao", "WARD_B", W),
        _nur(11, "Rahul Verma", "WARD_B", W),
        _nur(12, "Pallavi Desai", "WARD_B", ["ward", "emergency"]),
        _nur(13, "Radha Krishnan", "WARD_A", W),
        _nur(14, "Sanjay Mehta", "WARD_A", W),
        _nur(15, "Tara Menon", "WARD_A", W),
        _nur(16, "Uma Prabhu", "ICU", ["icu", "ward", "emergency"]),
        _nur(17, "Vasudha Iyer", "ICU", ["icu", "ward"]),
        _nur(18, "Yash Kapoor", "ICU", ["icu", "ward"]),
        _nur(19, "Zoya Fernandes", "ICU", ["icu", "ward"]),
        _nur(20, "Aarti Bansal", "ICU", ["icu", "ward", "emergency"], "mid"),
        _nur(21, "Bhavna Rathod", "OR", ["theatre", "ward"]),
        _nur(22, "Chetan Murthy", "OR", ["theatre", "ward"]),
        _nur(23, "Hema Latha", "EMERGENCY", ["emergency", "ward"], "oncall", True),
        _nur(24, "Ishaan Verma", "ICU", ["icu", "ward"], "oncall", True),
        _nur(25, "Jyothi Acharya", "OR", ["theatre", "ward"]),
        _nur(26, "Kishore Rai", "OR", ["theatre", "ward"]),
    ]


def default_beds():
    beds = []
    for i in range(1, 9):
        beds.append(Bed(f"E{i:02d}", "EMERGENCY", "emergency", f"Emergency {i:02d}"))
    for i in range(1, 7):
        beds.append(Bed(f"I{i:02d}", "ICU", "icu", f"ICU {i:02d}"))
    for i in range(1, 9):
        beds.append(Bed(f"A{i:02d}", "WARD_A", "general", f"Ward A {i:02d}"))
    for i in range(1, 9):
        beds.append(Bed(f"B{i:02d}", "WARD_B", "monitored" if i <= 4 else "general", f"Ward B {i:02d}"))
    for i in range(1, 9):
        beds.append(Bed(f"C{i:02d}", "WARD_C", "general", f"Ward C {i:02d}"))
    for i in range(1, 3):
        beds.append(Bed(f"OR{i}", "OR", "operating_room", f"Theatre {i}"))
    return beds


def default_equipment():
    units = []
    for kind, n, zone in (("ventilator", 5, "ICU"), ("cardiac_monitor", 10, "HUB"), ("defibrillator", 3, "EMERGENCY")):
        for i in range(1, n + 1):
            units.append(EquipmentUnit(f"{kind[:3].upper()}{i}", kind, location=zone))
    return units


def default_consumables():
    C = Consumable
    return [
        C("iv_sets", 300, 110, 600, unit="sets"),
        C("oxygen_masks", 140, 45, 300, unit="masks"),
        C("syringes", 900, 260, 1600, unit="pcs"),
        C("gloves", 3200, 1000, 5000, unit="pairs"),
        C("saline_bags", 260, 70, 500, unit="bags"),
        C("ecg_electrodes", 400, 110, 800, unit="pcs"),
    ]


# ------------------------------------------------------------------ state
class Hospital:
    def __init__(self, cfg):
        self.cfg = cfg
        self.now = 0
        self.doctors = {d.id: d for d in default_doctors()}
        self.nurses = {n.id: n for n in default_nurses()}
        self.beds = {b.id: b for b in default_beds()}
        self.equipment = {e.id: e for e in default_equipment()}
        self.consumables = {c.item: c for c in default_consumables()}
        self.patients = {}

    # ---- lookups
    def staff(self, sid):
        return self.doctors.get(sid) or self.nurses.get(sid)

    def all_staff(self):
        return list(self.doctors.values()) + list(self.nurses.values())

    def waiting(self):
        return [p for p in self.patients.values() if p.status == "waiting"]

    def active(self):
        return [p for p in self.patients.values() if p.status in ACTIVE]

    def bed_zone(self, bed_id):
        return self.beds[bed_id].zone

    def skill_counts(self):
        cnt = {}
        for s in self.all_staff():
            for k in s.skills:
                cnt[(s.role, k)] = cnt.get((s.role, k), 0) + 1
        return cnt

    def clone_for_planning(self):
        """Counterfactual copy: full deep copy of resources, only live patients."""
        h = copy.copy(self)
        h.doctors = copy.deepcopy(self.doctors)
        h.nurses = copy.deepcopy(self.nurses)
        h.beds = copy.deepcopy(self.beds)
        h.equipment = copy.deepcopy(self.equipment)
        h.consumables = {}
        h.patients = {p.id: copy.deepcopy(p) for p in self.patients.values() if p.status in ("waiting",) + ACTIVE}
        return h

    # ---- invariants (used by tests and by the engine in debug mode)
    def check_invariants(self):
        errs = []
        busy_staff, busy_beds, busy_eq = {}, {}, {}
        for p in self.active():
            for sid in ([p.assigned_doctor] if p.assigned_doctor else []) + list(p.assigned_nurses):
                if sid in busy_staff:
                    errs.append(f"double-booked staff {sid}: {busy_staff[sid]} & {p.id}")
                busy_staff[sid] = p.id
            if p.current_bed:
                if p.current_bed in busy_beds:
                    errs.append(f"double-booked bed {p.current_bed}")
                busy_beds[p.current_bed] = p.id
            for u in p.equipment_units:
                if u in busy_eq:
                    errs.append(f"double-booked equipment {u}")
                busy_eq[u] = p.id
            bed = self.beds.get(p.current_bed)
            if bed is None:
                errs.append(f"{p.id} active without bed")
                continue
            if bed.type not in BED_COMPAT[p.bed_type_required]:
                errs.append(f"{p.id} needs {p.bed_type_required} but is in {bed.type} bed {bed.id}")
            if bed.status not in ("reserved", "occupied") or bed.patient_id != p.id:
                errs.append(f"bed {bed.id} state inconsistent for {p.id}: {bed.status}/{bed.patient_id}")
            d = self.doctors.get(p.assigned_doctor)
            if d is None or p.required_specialty not in d.skills:
                errs.append(f"{p.id}: doctor {p.assigned_doctor} lacks specialty {p.required_specialty}")
            elif d.status in ("unavailable", "off_shift", "available"):
                errs.append(f"{p.id}: doctor {d.id} has status {d.status} while assigned")
            if len(p.assigned_nurses) != p.nurses_required:
                errs.append(f"{p.id}: {len(p.assigned_nurses)} nurses assigned, needs {p.nurses_required}")
            for nid in p.assigned_nurses:
                n = self.nurses.get(nid)
                if n is None or not set(p.required_nurse_skills) <= set(n.skills):
                    errs.append(f"{p.id}: nurse {nid} lacks skills {p.required_nurse_skills}")
                elif bed.zone not in n.covered_zones:
                    errs.append(f"{p.id}: nurse {nid} does not cover {bed.zone}")
                elif n.status in ("unavailable", "off_shift", "available"):
                    errs.append(f"{p.id}: nurse {nid} has status {n.status} while assigned")
        for s in self.all_staff():
            if s.current_patient and s.id not in busy_staff:
                errs.append(f"staff {s.id} points to {s.current_patient} but is not in an active bundle")
            if s.status in ("treating", "travelling", "assigned") and s.id not in busy_staff and not (s.status == "travelling" and s.busy_until):
                errs.append(f"staff {s.id} is {s.status} with no active patient")
        used = sum(1 for b in self.beds.values() if b.status in ("occupied", "reserved"))
        if used != len(busy_beds):
            errs.append(f"bed occupancy mismatch: {used} beds busy vs {len(busy_beds)} patients")
        return errs

    # ---- capacity views
    def bed_counts(self):
        out = {}
        for b in self.beds.values():
            o = out.setdefault(b.type, dict(total=0, operational=0, occupied=0, available=0, cleaning=0, unavailable=0))
            o["total"] += 1
            if b.status == "unavailable":
                o["unavailable"] += 1
                continue
            o["operational"] += 1
            if b.status in ("occupied", "reserved"):
                o["occupied"] += 1
            elif b.status == "cleaning":
                o["cleaning"] += 1
            else:
                o["available"] += 1
        return out

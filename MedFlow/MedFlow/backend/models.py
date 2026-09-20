"""Domain models: patients, staff, beds, equipment, consumables.

Plain dataclasses so state is structured (and easy to persist), not loose dicts.
Fields prefixed `hidden` in HIDDEN_PATIENT_FIELDS are the simulation's ground
truth and are never exposed to the optimizer or the API.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Optional

HIDDEN_PATIENT_FIELDS = {"actual_total", "hazard_draw", "end_time", "latent"}

PATIENT_STATUSES = ["waiting", "assigned", "in_treatment", "completed", "transferred"]
STAFF_STATUSES = ["available", "assigned", "treating", "travelling", "break", "unavailable", "emergency", "off_shift"]
BED_STATUSES = ["available", "occupied", "cleaning", "reserved", "unavailable"]
ACTIVE = ("assigned", "in_treatment")


@dataclass
class Patient:
    id: str
    name: str
    arrival_time: int
    urgency: int                                   # 1..10, 10 = most urgent (may deteriorate)
    base_urgency: int = 0
    age: int = 40
    sex: str = "U"
    symptoms: list = field(default_factory=list)
    vitals: dict = field(default_factory=dict)
    initial_diagnosis: str = ""
    risk_category: str = "LOW"                     # expert-system output (decision support)
    clinical_score: float = 0.0                    # C_p in [0,1]
    department: str = "General Medicine"
    required_specialty: str = "general"            # skill the treating doctor must hold
    suggested_specialty: str = "general"           # clinical suggestion (future doctor recommendation)
    required_nurse_skills: list = field(default_factory=lambda: ["ward"])
    nurses_required: int = 1
    bed_type_required: str = "general"
    equipment_required: dict = field(default_factory=dict)
    nominal_duration: int = 30                     # pathway nominal minutes (predictor input)
    consumption: dict = field(default_factory=dict)
    source: str = "generated"
    # ---- hidden ground truth
    actual_total: float = 30.0
    hazard_draw: float = 1e9
    end_time: Optional[int] = None
    latent: float = 0.0
    # ---- live state
    status: str = "waiting"
    care_minutes: float = 0.0                      # minutes spent assigned/treating (not waiting)
    work_done: float = 0.0                         # treatment minutes already delivered
    current_bed: Optional[str] = None
    assigned_doctor: Optional[str] = None
    assigned_nurses: list = field(default_factory=list)
    equipment_units: list = field(default_factory=list)
    assign_time: Optional[int] = None
    start_time: Optional[int] = None               # start of current treatment stint
    first_start_time: Optional[int] = None
    completed_time: Optional[int] = None
    predicted_duration: float = 0.0
    pred_end: Optional[int] = None                 # predicted completion (re-estimated on overrun)
    treatment_time_actual: Optional[float] = None
    overrun_flagged: bool = False
    deteriorations: int = 0
    interruptions: int = 0
    reserved_supplies: bool = False
    planned_start: Optional[int] = None
    planned_bundle: dict = field(default_factory=dict)
    conflict: str = ""
    binding_class: str = ""
    priority: dict = field(default_factory=dict)
    timeline: list = field(default_factory=list)

    def wait_so_far(self, now: float) -> float:
        """Minutes spent waiting (excludes time in assigned/treating stints)."""
        if self.status in ACTIVE:
            return self.wait_at_first_start(now)
        return max(0.0, now - self.arrival_time - self.care_minutes)

    def wait_at_first_start(self, now: float) -> float:
        t = self.first_start_time if self.first_start_time is not None else now
        return max(0.0, t - self.arrival_time)

    def log(self, t, label):
        self.timeline.append([t, label])

    def to_dict(self):
        d = asdict(self)
        for k in HIDDEN_PATIENT_FIELDS:
            d.pop(k, None)
        d["treatment_time_expected"] = round(self.predicted_duration) if self.predicted_duration else None
        return d


@dataclass
class Staff:
    id: str
    name: str
    role: str
    skills: list = field(default_factory=list)
    shift_label: str = "Day 08:00-20:00"
    shift_start: int = 0
    shift_end: int = 720
    on_call: bool = False
    status: str = "available"
    location: str = "HUB"
    home_zone: str = "HUB"
    covered_zones: list = field(default_factory=list)
    current_patient: Optional[str] = None
    unavailable_reason: str = ""
    unavailable_until: Optional[int] = None
    busy_until: Optional[int] = None               # relocation / travel end
    target_zone: Optional[str] = None
    leaving: bool = False                          # shift ended while busy
    relocated_from: Optional[str] = None
    specialty: str = ""
    treat_minutes: float = 0.0
    travel_minutes: float = 0.0
    idle_minutes: float = 0.0
    available_minutes: float = 0.0
    assignments: int = 0
    notifications: list = field(default_factory=list)

    @property
    def workload(self) -> float:
        return self.treat_minutes + self.travel_minutes

    def notify(self, t, text, level="info"):
        self.notifications.append({"t": t, "text": text, "level": level})
        del self.notifications[:-30]

    def to_dict(self):
        d = asdict(self)
        d["workload"] = round(self.workload, 1)
        d["qualifications"] = list(self.skills)
        return d


class Doctor(Staff):
    pass


class Nurse(Staff):
    pass


@dataclass
class Bed:
    id: str
    zone: str
    type: str                                      # general | icu | emergency | monitored | operating_room
    label: str = ""
    status: str = "available"
    patient_id: Optional[str] = None
    doctor_id: Optional[str] = None
    nurse_ids: list = field(default_factory=list)
    cleaning_until: Optional[int] = None
    unavailable_reason: str = ""
    unavailable_until: Optional[int] = None
    temporary: bool = False
    expected_completion: Optional[int] = None
    busy_minutes: float = 0.0
    available_minutes: float = 0.0

    @property
    def ward(self):
        return self.zone

    def to_dict(self):
        d = asdict(self)
        d["ward"] = self.zone
        return d


@dataclass
class EquipmentUnit:
    id: str
    kind: str
    status: str = "available"                      # available | in_use | unavailable
    patient_id: Optional[str] = None
    location: str = "HUB"
    temporary: bool = False
    unavailable_reason: str = ""
    busy_minutes: float = 0.0

    def to_dict(self):
        return asdict(self)


@dataclass
class Consumable:
    item: str
    quantity: float
    min_threshold: float
    max_capacity: float
    allocated: float = 0.0
    location: str = "Central store"
    unit: str = "units"
    consumed: float = 0.0
    restocked: float = 0.0

    @property
    def available(self):
        return self.quantity - self.allocated

    def to_dict(self):
        d = asdict(self)
        d["available"] = round(self.available, 1)
        d["status"] = ("critical" if self.quantity <= 0 else "low" if self.quantity < self.min_threshold else "ok")
        return d

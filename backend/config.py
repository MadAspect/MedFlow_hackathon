"""MedFlow configuration.

Every tunable number in the optimizer lives here so it can be documented, shown
in the UI ("Algorithm" page) and changed per scenario.  NONE of these values are
clinically validated - they are operational prototype parameters.
"""
from __future__ import annotations
import copy
from dataclasses import dataclass, field, asdict

CATEGORIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]


def urgency_category(u: float) -> str:
    """Urgency is a 1-10 integer (10 = most urgent), as in the original MVP."""
    return "CRITICAL" if u >= 8 else "HIGH" if u >= 6 else "MEDIUM" if u >= 4 else "LOW"


# Scheduling strategies used for the comparison experiments.
#   lookahead   : plan future start times + reserve resources for higher-priority
#                 patients (backfilling).  False = myopic "assign now or skip".
#   cost_aware  : choose the staff/bed bundle by travel/scarcity/workload cost.
#                 False = first compatible resource by id.
#   local_search: improve the priority order by minimising the objective J.
#   adaptive_emergency : Emergency-Mode weight/profile switch + auto reallocation.
STRATEGIES = {
    "urgency_only": dict(label="Urgency only", weights={"u": 1, "w": 0, "d": 0, "r": 0, "c": 0},
                         lookahead=False, cost_aware=False, local_search=False,
                         adaptive_emergency=False, auto_reallocate=False),
    "urgency_wait": dict(label="Urgency + waiting time", weights={"u": .6, "w": .4, "d": 0, "r": 0, "c": 0},
                         lookahead=False, cost_aware=False, local_search=False,
                         adaptive_emergency=False, auto_reallocate=False),
    "optimized_static": dict(label="Full optimizer, no emergency adaptation", weights=None,
                             lookahead=True, cost_aware=True, local_search=True,
                             adaptive_emergency=False, auto_reallocate=False),
    "full": dict(label="MedFlow full optimization", weights=None,
                 lookahead=True, cost_aware=True, local_search=True,
                 adaptive_emergency=True, auto_reallocate=True),
}


@dataclass
class Config:
    # ---- patient priority  S_p = sum_k w_k * component_k  (all components in [0,1])
    weights_normal: dict = field(default_factory=lambda: {"u": .35, "w": .25, "d": .15, "r": .05, "c": .20})
    weights_emergency: dict = field(default_factory=lambda: {"u": .40, "w": .15, "d": .20, "r": .05, "c": .20})
    # operational target time-to-treatment (min) used to normalise waiting pressure
    target_wait: dict = field(default_factory=lambda: {"CRITICAL": 5, "HIGH": 15, "MEDIUM": 45, "LOW": 90})
    # deterioration hazard while waiting (per minute) by category - prototype assumption
    hazard_per_min: dict = field(default_factory=lambda: {"CRITICAL": 0.012, "HIGH": 0.006, "MEDIUM": 0.0015, "LOW": 0.0003})
    baseline_risk_factor: float = 0.4          # r0 = factor * clinical_score

    # ---- objective  J = a*wait + b*critical_wait + g*idle + d*travel + e*unserved + z*reassign
    J: dict = field(default_factory=lambda: dict(alpha=1.0, beta=4.0, gamma=0.05, delta=0.5, epsilon=40.0, zeta=3.0))
    critical_multiplier: dict = field(default_factory=lambda: {"HIGH": 1.0, "CRITICAL": 2.0})
    emergency_beta_mult: float = 2.0
    horizon: int = 120                          # planning horizon (min)
    ls_iters: int = 3                           # local-search passes
    ls_window: int = 6                          # adjacent swaps tried per pass
    max_plan_patients: int = 30
    # bundle-selection cost weights (minute-equivalents)
    bundle: dict = field(default_factory=lambda: dict(scarcity=3.0, workload=2.0, zone_mismatch=1.0, bed_class=1.5))
    shift_end_buffer: int = 15                  # no new assignment this close to shift end
    cleaning_minutes: dict = field(default_factory=lambda: {"default": 5, "icu": 10, "operating_room": 12, "emergency": 6})

    # ---- treatment-duration uncertainty (ground truth of the simulation)
    # actual = nominal * bias[dept] * exp(sigma*Z - sigma^2/2),  Z ~ N(0,1)
    duration_sigma: float = 0.30
    duration_bias: dict = field(default_factory=lambda: {"Emergency": 1.15, "Cardiology": 1.25, "Orthopedics": 1.10})
    overrun_extension_frac: float = 0.25        # predicted end is extended by this * expected...
    overrun_extension_min: int = 5              # ...but at least this many minutes
    adaptive_lr: float = 0.15                   # AdaptiveDurationPredictor learning rate
    adaptive_min_samples: int = 3

    # ---- re-optimization cadence
    replan_interval: int = 5
    sample_interval: int = 5
    transfer_after_wait: int = 60               # infeasible-for-this-hospital patients are transferred

    # ---- emergency mode (thresholds are configurable, NOT medically validated)
    emergency: dict = field(default_factory=lambda: {
        "critical_queue":  dict(label="Critical-patient queue", warn=2, emergency=4, unit="patients"),
        "critical_wait":   dict(label="Longest critical wait", warn=8, emergency=15, unit="min"),
        "icu_slack":       dict(label="ICU slack (free beds - waiting ICU patients)", warn=1, emergency=-1, unit="beds", low=True),
        "staff_shortage":  dict(label="Staff unavailable", warn=0.10, emergency=0.25, unit="fraction"),
        "arrival_surge":   dict(label="Arrival rate vs baseline", warn=1.8, emergency=2.5, unit="x"),
        "queue_length":    dict(label="Total waiting queue", warn=8, emergency=16, unit="patients"),
        "capacity_pressure": dict(label="Peak resource bottleneck score", warn=1.0, emergency=2.0, unit="score"),
        "critical_burst":  dict(label="Critical arrivals in 10 min", warn=2, emergency=3, unit="patients"),
        "resource_failures": dict(label="Failed critical resources", warn=1, emergency=2, unit="resources"),
        "deterioration":   dict(label="Deteriorated patients waiting", warn=2, emergency=4, unit="patients"),
    })
    em_confirm_min: int = 3
    em_exit_factor: float = 0.75                # exit thresholds = factor * entry thresholds
    em_recovery_min: int = 15
    em_recovery_hold_min: int = 15
    em_warn_clear_min: int = 10
    surge_window: int = 40
    baseline_rate_per_hour: float = 8.0

    # ---- bottleneck detection / interventions
    bottleneck_threshold: float = 1.0
    growth_window: int = 30
    reco_interval: int = 10
    reco_min_gain: float = 0.5                  # min projected avg-wait gain (min) to recommend
    auto_cooldown: int = 6
    max_temp_beds: int = 4
    restore_after_normal_min: int = 20

    # ---- inventory forecasting
    forecast_horizon_min: int = 1440
    restock_buffer_pct: float = 0.10

    def to_dict(self):
        return asdict(self)

    def update(self, overrides: dict | None):
        """Deep-merge overrides (dict of dicts) into this config."""
        for k, v in (overrides or {}).items():
            cur = getattr(self, k)
            if isinstance(cur, dict) and isinstance(v, dict):
                for kk, vv in v.items():
                    if isinstance(cur.get(kk), dict) and isinstance(vv, dict):
                        cur[kk].update(vv)
                    else:
                        cur[kk] = vv
            else:
                setattr(self, k, v)
        return self

    def copy(self):
        return copy.deepcopy(self)


PARAM_DOCS = {
    "weights_normal": "Priority weights w_u,w_w,w_d,w_r,w_c (sum to 1) in NORMAL mode.",
    "weights_emergency": "Priority weights while Emergency Mode is active (more weight on urgency/deterioration).",
    "target_wait": "Operational target time-to-treatment per category; normalises waiting pressure W_p = min(1, wait/target).",
    "hazard_per_min": "Assumed deterioration hazard per waiting minute; D_p = 1-(1-r0)exp(-h*wait).",
    "J": "Objective weights: alpha wait, beta critical wait (squared, relative to target), gamma idle, delta travel, epsilon unserved, zeta reassignment.",
    "duration_sigma": "Log-normal sigma of actual/expected treatment duration (mean-preserving).",
    "horizon": "Rolling planning horizon in minutes.",
    "emergency": "Indicator thresholds for NORMAL -> WARNING -> EMERGENCY -> RECOVERY transitions.",
}

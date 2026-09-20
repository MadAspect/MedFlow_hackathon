"""Prediction layer.  The optimizer consumes STANDARDISED predictions and never
knows how they were produced (rules today, ML models later):

    PatientData -> PredictionService -> {duration, remaining, risk, demand} -> Planner

Implemented predictors are deliberately lightweight and dependency-free:
  * RuleBasedDurationPredictor  - pathway nominal minutes (default, no ML needed)
  * AdaptiveDurationPredictor   - online per-department bias correction (EWMA) learned
                                  from completed treatments; measurable via MAE
  * DemandPredictor             - EWMA of 15-minute arrival counts
  * RiskPredictor               - deterioration hazard while waiting
  * ResourceDemandPredictor     - concurrent resource demand implied by forecast arrivals
The optimizer stays the source of truth: predictions can never override hard constraints.
"""
from __future__ import annotations
import math


class DurationPredictor:
    name = "base"

    def predict(self, p) -> float:
        raise NotImplementedError

    def update(self, p, actual: float):
        pass


class RuleBasedDurationPredictor(DurationPredictor):
    name = "rule_based"

    def predict(self, p) -> float:
        return float(p.nominal_duration)


class AdaptiveDurationPredictor(RuleBasedDurationPredictor):
    """expected = nominal * ratio[dept];  ratio <- (1-lr)*ratio + lr*(actual/nominal)  (after n>=min samples)."""
    name = "adaptive_ewma"

    def __init__(self, lr=0.15, min_samples=3):
        self.lr, self.min_samples = lr, min_samples
        self.ratio, self.n = {}, {}

    def predict(self, p) -> float:
        r = self.ratio.get(p.department, 1.0) if self.n.get(p.department, 0) >= self.min_samples else 1.0
        return p.nominal_duration * r

    def update(self, p, actual):
        d = p.department
        obs = actual / max(1.0, p.nominal_duration)
        self.n[d] = self.n.get(d, 0) + 1
        prev = self.ratio.get(d, obs)
        self.ratio[d] = obs if self.n[d] == 1 else (1 - self.lr) * prev + self.lr * obs


class RiskPredictor:
    """Deterioration hazard per waiting minute for a patient (category-based rule)."""
    def __init__(self, cfg):
        self.cfg = cfg

    def hazard(self, p) -> float:
        from .config import urgency_category
        return self.cfg.hazard_per_min[urgency_category(p.urgency)]

    def deterioration_prob(self, p, wait: float) -> float:
        r0 = self.cfg.baseline_risk_factor * p.clinical_score
        return 1 - (1 - r0) * math.exp(-self.hazard(p) * wait)


class DemandPredictor:
    """EWMA over 15-minute arrival bins -> forecast arrivals/hour."""
    def __init__(self, alpha=0.5, bin_min=15):
        self.alpha, self.bin = alpha, bin_min

    def forecast(self, arrival_times, now, baseline_per_hour=None):
        if now < self.bin:
            return dict(rate_per_hour=baseline_per_hour or 0.0, trend=0.0, samples=0)
        nbins = min(8, now // self.bin)
        counts = []
        for k in range(nbins, 0, -1):
            lo, hi = now - k * self.bin, now - (k - 1) * self.bin
            counts.append(sum(1 for t in arrival_times if lo < t <= hi))
        level = counts[0]
        for c in counts[1:]:
            level = self.alpha * c + (1 - self.alpha) * level
        trend = (counts[-1] - counts[0]) / max(1, len(counts) - 1) if len(counts) > 1 else 0.0
        return dict(rate_per_hour=round(level * 60 / self.bin, 2), trend=round(trend * 60 / self.bin, 2), samples=len(counts))


class ResourceDemandPredictor:
    """Average concurrent demand (units) per resource class implied by a forecast arrival rate.

    demand_class = rate/h * E[unit-hours per patient of class] using the last hour of arrivals as the case mix."""
    def project(self, recent_patients, rate_per_hour, observed_rate, predictor):
        out = {}
        if not recent_patients or rate_per_hour <= 0:
            return out
        scale = rate_per_hour / max(observed_rate, 1e-6) if observed_rate else 1.0
        for p in recent_patients:
            hrs = predictor.predict(p) / 60.0
            for key, units in ((f"bed:{p.bed_type_required}", 1), (f"doctor:{p.required_specialty}", 1),
                               ("nurse:all", p.nurses_required)):
                out[key] = out.get(key, 0.0) + units * hrs
        # recent_patients cover the last 60 min, so out is unit-hours per hour of the observed mix
        return {k: round(v * scale, 2) for k, v in out.items()}


class PredictionService:
    def __init__(self, cfg, adaptive=False):
        self.cfg = cfg
        self.duration = AdaptiveDurationPredictor(cfg.adaptive_lr, cfg.adaptive_min_samples) if adaptive else RuleBasedDurationPredictor()
        self.risk = RiskPredictor(cfg)
        self.demand = DemandPredictor()
        self.resource_demand = ResourceDemandPredictor()
        self.errors = []          # (predicted, actual, dept, nominal)

    # ---- durations
    def expected_total(self, p) -> float:
        return max(3.0, self.duration.predict(p))

    def new_stint(self, p) -> int:
        """Predicted minutes still needed when a stint (re)starts."""
        return max(3, int(math.ceil(self.expected_total(p) - p.work_done)))

    def extension(self, p) -> int:
        """When an in-progress treatment passes its predicted end, extend the estimate by this many minutes."""
        return max(self.cfg.overrun_extension_min, int(round(self.cfg.overrun_extension_frac * self.expected_total(p))))

    def observe(self, p, predicted_at_start, actual):
        self.errors.append((float(predicted_at_start), float(actual), p.department, p.nominal_duration))
        self.duration.update(p, actual)

    def accuracy(self):
        if not self.errors:
            return dict(n=0, mae=None, mae_nominal=None, bias=None)
        n = len(self.errors)
        mae = sum(abs(a - p) for p, a, _, _ in self.errors) / n
        mae_nom = sum(abs(a - nom) for _, a, _, nom in self.errors) / n
        bias = sum(a - p for p, a, _, _ in self.errors) / n
        return dict(n=n, mae=round(mae, 2), mae_nominal=round(mae_nom, 2), bias=round(bias, 2), predictor=self.duration.name)

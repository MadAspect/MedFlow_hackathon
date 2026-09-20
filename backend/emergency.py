"""Automatic Emergency Mode: NORMAL -> WARNING -> EMERGENCY -> RECOVERY -> NORMAL.

Driven only by measurable hospital-state indicators with configurable thresholds
(NOT medically validated).  Escalation needs `em_confirm_min` consecutive minutes
above a threshold (debounce); de-escalation uses lower exit thresholds
(`em_exit_factor`) held for `em_recovery_min` minutes (hysteresis) to avoid flapping.
"""
from __future__ import annotations

LEVELS = {"NORMAL": 0, "WARNING": 1, "RECOVERY": 1, "EMERGENCY": 2}


def indicator_level(spec, value, exit_mode=False, factor=0.75):
    low = spec.get("low", False)
    w, e = spec["warn"], spec["emergency"]
    if exit_mode:                      # exit thresholds are less strict than entry thresholds
        if low:
            w, e = w + (1 - factor) * abs(w) + 0.5, e + (1 - factor) * abs(e) + 0.5
        else:
            w, e = w * factor, e * factor
    if low:
        return 2 if value <= e else 1 if value <= w else 0
    return 2 if value >= e else 1 if value >= w else 0


class EmergencyController:
    def __init__(self, cfg):
        self.cfg = cfg
        self.state = "NORMAL"
        self.since = 0
        self.trigger = ""
        self.trigger_keys = []
        self.history = []               # transitions
        self.indicators = {}
        self._hi = self._warn = self._calm = self._exit_ok = self._hold = 0

    def evaluate(self, values):
        cfg = self.cfg
        res, top, exit_top = {}, 0, 0
        for k, spec in cfg.emergency.items():
            v = values.get(k, 0)
            lv = indicator_level(spec, v)
            ex = indicator_level(spec, v, True, cfg.em_exit_factor)
            res[k] = dict(spec, value=round(v, 2), level=lv, exit_level=ex)
            top, exit_top = max(top, lv), max(exit_top, ex)
        self.indicators = res
        return top, exit_top

    def _why(self, level):
        parts = []
        for k, r in self.indicators.items():
            if r["level"] >= level:
                op = "<=" if r.get("low") else ">="
                thr = r["emergency"] if level == 2 else r["warn"]
                parts.append(f"{r['label']} = {r['value']} ({op} {thr} {r['unit']})")
        return "; ".join(parts), [k for k, r in self.indicators.items() if r["level"] >= level]

    def update(self, t, values):
        """Advance the state machine one minute. Returns a transition dict or None."""
        cfg = self.cfg
        top, exit_top = self.evaluate(values)
        self._hi = self._hi + 1 if top >= 2 else 0
        self._warn = self._warn + 1 if top >= 1 else 0
        self._calm = self._calm + 1 if top == 0 else 0
        self._exit_ok = self._exit_ok + 1 if exit_top < 2 else 0
        new = self.state
        if self.state in ("NORMAL", "WARNING", "RECOVERY"):
            if self._hi >= cfg.em_confirm_min:
                new = "EMERGENCY"
            elif self.state == "NORMAL" and self._warn >= cfg.em_confirm_min:
                new = "WARNING"
            elif self.state == "WARNING" and self._calm >= cfg.em_warn_clear_min:
                new = "NORMAL"
            elif self.state == "RECOVERY":
                self._hold += 1
                if self._hold >= cfg.em_recovery_hold_min:
                    new = "WARNING" if top >= 1 else "NORMAL"
        elif self.state == "EMERGENCY":
            if self._exit_ok >= cfg.em_recovery_min:
                new = "RECOVERY"
        if new != self.state:
            old = self.state
            text, keys = self._why(2 if new == "EMERGENCY" else 1)
            tr = dict(t=t, from_state=old, to_state=new, trigger=text if new in ("EMERGENCY", "WARNING") else "Indicators back below exit thresholds",
                      trigger_keys=keys if new in ("EMERGENCY", "WARNING") else [],
                      indicators={k: r["value"] for k, r in self.indicators.items()})
            self.history.append(tr)
            self.state, self.since, self._hold = new, t, 0
            if new in ("EMERGENCY", "WARNING"):
                self.trigger, self.trigger_keys = tr["trigger"], tr["trigger_keys"]
            self._hi = self._warn = 0
            return tr
        return None

    def to_dict(self, now):
        return dict(state=self.state, since=self.since, duration=now - self.since, trigger=self.trigger,
                    trigger_keys=self.trigger_keys, indicators=self.indicators, history=self.history[-20:])

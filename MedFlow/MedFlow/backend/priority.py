"""Patient priority engine.

    S_p = w_u*U_p + w_w*W_p + w_d*D_p + w_r*R_p + w_c*C_p            (all components in [0,1])

U_p  urgency          (urgency-1)/9
W_p  waiting pressure min(1, wait / target_wait[category])   - normalised by the *category's* target,
                      so a LOW patient that has waited 90 min ages to the same pressure as a CRITICAL one at 5 min
D_p  deterioration    1 - (1-r0) * exp(-h * wait),  r0 = 0.4*C_p,  h = hazard(category)
R_p  resource factor  fraction of the patient's required resource classes (bed, doctor, nurse, equipment)
                      that have a compatible unit free right now (utilisation tie-breaker, small weight)
C_p  clinical index   expert-system risk score (+0.05 per observed deterioration)

Weights are configurable (config.py) and switch in Emergency Mode.
"""
from __future__ import annotations
import math
from .config import urgency_category


def components(p, now, cfg, risk, avail_frac=1.0):
    cat = urgency_category(p.urgency)
    wait = p.wait_so_far(now)
    U = (p.urgency - 1) / 9.0
    W = min(1.0, wait / cfg.target_wait[cat])
    r0 = cfg.baseline_risk_factor * p.clinical_score
    D = 1 - (1 - r0) * math.exp(-risk.hazard(p) * wait)
    C = min(1.0, p.clinical_score + 0.05 * p.deteriorations)
    return dict(U=round(U, 4), W=round(W, 4), D=round(D, 4), R=round(avail_frac, 4), C=round(C, 4),
                wait=round(wait, 1), category=cat, breach=bool(wait >= cfg.target_wait[cat]))


def score(comp, weights):
    return (weights["u"] * comp["U"] + weights["w"] * comp["W"] + weights["d"] * comp["D"]
            + weights["r"] * comp["R"] + weights["c"] * comp["C"])


def rank(patients, now, cfg, weights, risk, avail_fn=None):
    """Return [(patient, S, components)] sorted by score desc (ties: earlier arrival, then id)."""
    out = []
    for p in patients:
        comp = components(p, now, cfg, risk, avail_fn(p) if avail_fn else 1.0)
        comp["S"] = round(score(comp, weights), 4)
        out.append((p, comp["S"], comp))
    out.sort(key=lambda t: (-t[1], t[0].arrival_time, t[0].id))
    return out

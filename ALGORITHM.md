# MedFlow - the algorithm as implemented

This document describes what the code in `backend/` actually does. All parameter values are the defaults in
`backend/config.py`; the in-app **Algorithm** page prints the live values. Everything here is an
**operational prototype** - none of the parameters are clinically validated.

## 0. Pipeline

```
arrivals -> expert triage (decision support) -> priority S_p -> Planner (hard constraints, then cost)
        -> commit assignments due now -> simulate a minute -> observe events -> (re)optimize
        -> emergency-mode monitor -> bottleneck analysis -> counterfactual interventions -> analytics
```

Modules: `expert.py` (triage), `priority.py` (S_p), `allocation.py` (Planner), `engine.py` (state + rolling horizon),
`emergency.py`, `bottleneck.py`, `prediction.py`, `analytics.py`, `scenarios.py` (arrivals + ground truth), `db.py`.

## 1. Patient priority

Urgency `u` is an integer 1..10 (10 = most urgent). Category: CRITICAL >= 8, HIGH >= 6, MEDIUM >= 4, else LOW.

```
S_p = w_u*U_p + w_w*W_p + w_d*D_p + w_r*R_p + w_c*C_p
U_p = (u - 1) / 9
W_p = min(1, wait_p / target[cat])           target = {CRITICAL 5, HIGH 15, MEDIUM 45, LOW 90} minutes
D_p = 1 - (1 - r0) * exp(-h[cat] * wait_p)    r0 = 0.4*C_p ; h = {CRITICAL .012, HIGH .006, MEDIUM .0015, LOW .0003} per min
R_p = (# of the patient's required resource classes that have a compatible unit free right now) / (# required classes)
C_p = expert-system risk score (0..1) + 0.05 per observed deterioration, capped at 1
```

`wait_p` = minutes spent waiting (time in assigned/treating stints is excluded, so an interrupted patient keeps its
accrued waiting pressure). All five components are in [0,1], so no scale distorts the sum.

Weights: NORMAL `w = (u .35, w .25, d .15, r .05, c .20)`; EMERGENCY `(u .40, w .15, d .20, r .05, c .20)`.
Weights are documented prototype settings; they are *not* claimed to be medically optimal.

Why waiting is normalised by the category target: a LOW patient at 90 min and a CRITICAL patient at 5 min have the same
waiting pressure (W=1). Aging therefore prevents starvation but cannot, on its own, lift a low-urgency patient over a
critical one (W contributes at most `w_w`).

Expert system (`expert.py`): noisy-OR `C = 1 - prod_i(1 - s_i)` over symptom weights, vital-sign flags (SpO2, HR, SBP,
RR, age) and two pattern bonuses; suggested urgency = `round(1 + 9C)`. The primary complaint's group plus the category
selects a *pathway* (department, doctor specialty, bed type, nurse skills/count, equipment, nominal minutes).
It is decision support, not a diagnosis.

## 2. Hard constraints (enforced before any cost is considered)

| | constraint | where enforced |
|---|---|---|
| H1 | every bed/doctor/nurse/equipment unit is used by at most one patient at any time | interval calendars in `Planner`; `Hospital.check_invariants()` re-checks live state |
| H2 | bed compatibility: icu -> icu; emergency -> emergency (+ monitored overflow only if urgency < 8); monitored -> monitored/icu; general -> general/monitored; theatre -> theatre. In Emergency Mode patients with urgency < 6 may only use their primary type | `_acceptable_beds` |
| H3 | doctor holds `required_specialty` | `_context` |
| H4 | nurse holds ALL required skills, `nurses_required` of them, and covers the bed's ward | `_try` |
| H5 | staff on shift, not `unavailable`/`off_shift`, not within 15 min of shift end for a new start; failed/cleaning beds and failed equipment are unavailable until restored | `_prepare` |
| H6 | required equipment units are free | `_try` |

If no bundle exists the patient is *unscheduled* with an explicit reason (`No qualified doctor ...`, `No operational bed ...`,
`ICU capacity constrained: 2 waiting patient(s) ... only 1 of 5 operational compatible bed(s) are free`). After a
commit the engine re-validates the bundle against the live state and rejects it if anything changed.

## 3. Objective

```
J = alpha*sum(wait) + beta*sum m_p (wait_p/target_p)^2 + gamma*idle + delta*travel + epsilon*unserved + zeta*reassign
alpha=1.0  beta=4.0 (x2 in Emergency Mode)  gamma=0.05  delta=0.5  epsilon=40  zeta=3
```
* `wait`: planned start minus arrival for every waiting patient (unscheduled patients count as waiting until horizon end).
* critical term: only HIGH (m=1) and CRITICAL (m=2) patients; squared and target-relative, so one critical patient
  waiting twice as long costs 4x - a low *average* wait cannot hide a very long critical wait.
* `idle`: unused doctor+nurse minutes between now and the plan's last finish (capped at the horizon).
* `travel`: total staff travel minutes over the layout graph (Floyd-Warshall corridor distances, 1-6 min).
* `unserved`: sum of `(0.5 + U_p)` over patients that cannot be scheduled within the horizon (120 min).
* `reassign`: number of bed/doctor/nurse changes relative to the previous plan for the same patient (continuity).

## 4. How the plan is built (`allocation.py`)

Priority-ordered *serial schedule generation with backfilling* (a standard resource-constrained scheduling heuristic):

1. Build calendars: current commitments (active patients hold their resources until their *predicted* end), cleaning beds,
   relocating staff, availability windows.
2. Order waiting patients by S_p (tie: earlier arrival, id). At most 30 are planned per epoch.
3. For each patient, candidate dispatch times are `now` plus (up to 24) times at which a relevant resource frees up or
   comes on shift, within the horizon. At each candidate time `s` the planner searches feasible bundles: bed b, doctor,
   k nurses (covering b's ward), equipment. Feasibility is checked conservatively over `[s, s+duration+max_travel]`.
4. The first `s` with a feasible bundle wins; among feasible bundles the cheapest is chosen:
   ```
   staff cost = (alpha+delta)*travel_min + 2*(workload/(now+60)) + 3*sum_{unneeded skills}(1/#staff with skill) + 1.5 if not in previous plan
   bed cost   = 1.5*(1+|rank diff|) if not the primary bed type + 1*ward_distance(dept home, bed ward) + 1.5 if not in previous plan
   ```
   (the scarcity term keeps ICU-certified nurses and emergency doctors free for patients who need them).
5. The bundle is booked on the calendars (staff `[s, T+d]`, bed `[s, T+d+cleaning]`, equipment `[s, T+d]`, with
   `T = s + max staff travel`), so later (lower-priority) patients only see the remaining gaps: a lower-priority patient
   is backfilled only if it does not delay a higher-priority reservation.
6. *Local search*: up to 3 passes, each tries the first 6 adjacent swaps in the priority order, rebuilds the whole plan and
   keeps a swap only if J decreases (first improvement). At most 18 extra plan evaluations per epoch.
7. Output: tentative plan (dispatch time, treatment start, bundle, binding resource per patient) + unscheduled list +
   J breakdown + conflicts. The engine commits only items with `dispatch_time <= now`.

Complexity per plan: `O(P * T * B * (D + N))` (P waiting patients, T candidate times, B beds, D doctors, N nurses);
local search multiplies by <= 19. Measured: ~1-5 ms per plan at demo scale (40 beds, 14 doctors, 26 nurses).

Why it is reasonable: the calendars make H1-H6 hold by construction; priority ordering implements the clinical ranking;
reservations protect critical patients from being starved by backfill; cost-aware bundling reduces travel and preserves
scarce skills; local search directly lowers the stated objective. It is a heuristic - no optimality guarantee.

## 5. Rolling-horizon loop (`engine.py`)

Each simulated minute: scripted/manual events -> shift changes -> timers (cleaning, restorations, relocations) ->
arrivals -> progress (start treatments, complete, detect overruns) -> deterioration -> transfers -> emergency-mode update
-> **re-optimize if an event occurred or every 5 minutes** -> bottleneck analysis -> interventions -> sampling.
Triggers recorded per epoch: `arrival, completion, overrun of P###, patient deterioration, staff on shift, shift ended,
bed ready, resource change, relocation complete, mode <STATE>, periodic`. Only the assignments due now are committed;
the rest of the plan is tentative and recomputed at the next epoch, and the change in each waiting patient's planned
start/bundle is logged ("downstream plan changes").

## 6. Uncertain treatment duration

Ground truth (hidden from the optimizer): `actual = nominal * bias[dept] * exp(sigma*Z - sigma^2/2)`, `Z ~ N(0,1)`,
`sigma = 0.30` (mean-preserving log-normal: E[actual] = nominal*bias; right-skewed so long overruns are more likely than
equally long early finishes). Hidden systematic bias `{Emergency 1.15, Cardiology 1.25, Orthopedics 1.10}` mimics
an optimistic clinical pathway.

Detection: while `now >= predicted_end` the resource stays occupied, an `overrun` event is logged once, the estimate is
extended by `max(5, 0.25*expected)` (repeatedly), and an immediate re-optimization shifts every dependent planned start.
Early completions release resources immediately and trigger a re-optimization. Optional `AdaptiveDurationPredictor`
learns a per-department ratio (EWMA, rate 0.15, after 3 samples); MAE of predictions is reported.

## 7. Resource changes (Head Nurse control)

`Engine.apply_change` is the single entry point: (1) update state; (2) find assignments using the resource;
(3) for a lost staff member try an immediate qualified substitute (skills, ward coverage, travel, scarcity, workload),
otherwise interrupt the patient (work done is kept, patient re-queued); (4) re-optimize; (5) notify affected staff;
(6) produce an impact record (affected patients, before/after, reasons, conflicts, remaining capacity, current bottleneck).
Beds, equipment, staff, temporary beds/equipment, consumables all use this path.

## 8. Emergency Mode (`emergency.py`)

Indicators (warning / emergency, configurable): critical queue (2/4), longest critical wait min (8/15), ICU slack =
free ICU beds - waiting ICU patients (<=1 / <=-1), staff unavailable fraction (.10/.25), arrival rate vs baseline in last
40 min (1.8x/2.5x, needs >= 6 arrivals), total queue (8/16), peak bottleneck score of classes with >= 2 blocked patients
(1.0/2.0), critical arrivals in 10 min (2/3), failed critical resources (1/2), deteriorated waiting patients (2/4).
Transitions: NORMAL -> WARNING/EMERGENCY need 3 consecutive minutes; EMERGENCY -> RECOVERY needs all indicators below
`0.75x` thresholds for 15 min; RECOVERY holds 15 min then WARNING/NORMAL; WARNING -> NORMAL after 10 calm minutes.
In EMERGENCY (strategy `full` only): emergency weights, beta x2, no overflow of low-urgency patients into higher-level beds,
and automatic application of the best counterfactual intervention (cooldown 6 min). Temporary redeployments are reversed
20 minutes after return to NORMAL.

## 9. Bottleneck detection (`bottleneck.py`)

For each class (nurses per ward, doctors per skill, beds per type, equipment per kind):
`U = busy/capacity`, `DP = min(3, (busy+queued)/capacity)`, `QG = 1 + max(0, queue growth in 30 min)/capacity`,
`B = U*DP*QG`. A class is a bottleneck if `B >= 1.0` **and** patients are blocked on it. "Blocked on" is attributed by the
planner: the resource role that becomes available last for a patient is its binding constraint; the delay attributed to
the class is planned start minus now. Primary/secondary = highest B; the cause text (utilization, queued demand, queue
growth, idle capacity elsewhere) is built from the numbers.

Interventions - move an idle nurse into the bottleneck ward, call in an on-call/off-shift staff member, open a temporary
bed, borrow equipment - are evaluated counterfactually: clone the hospital, apply the change, re-run the planner (no local
search), compare average projected wait of the queue, high-urgency wait and unscheduled count. Only interventions with a
positive projected effect (>= 0.5 min) are recommended; the numbers in the UI are exactly those differences. The effect
on the source ward is included because the planner covers every patient.

## 10. Inventory forecasting (`analytics.inventory_forecast`)

Consumption is reserved at assignment (`allocated`) and consumed at completion from per-patient category profiles.
`rate = consumed / elapsed minutes`; `projected = stock - rate*1440` (next 24 h, no resupply);
`target = safety_threshold * 1.10`; `restock = ceil(min(max(0, target - projected), max_capacity - stock))`.
Level: `below_threshold` (stock < safety), `shortage` (projected < safety), `critical` (stock 0), else `ok`.
Consumables raise alerts and are not hard scheduling constraints; equipment units are hard constraints.

## 11. Prediction layer

`PredictionService` exposes duration, remaining-time extension, deterioration hazard and demand forecasts (EWMA of
15-min arrival counts; resource-demand projection). The planner only consumes these numbers, so a trained model could
replace any predictor without touching the optimizer, and predictions can never override H1-H6.

## 12. Limitations

* Heuristic optimizer; no optimality proof. Strategy comparisons are measured on simulated days and depend on scenario and seed.
* One task per staff member at a time; treatments are non-preemptive; travel time is graph distance only.
* Only some scarce resources have hard constraints on stock (equipment yes, consumables no).
* All clinical and operational parameters are prototype assumptions; the synthetic patient stream is not real data.
* Interrupted treatments resume with their remaining work but require a full new bundle.
* The live state is in memory; SQLite stores the audit trail/metrics of a run but a run cannot be resumed from the DB.

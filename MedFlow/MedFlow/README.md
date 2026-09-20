# MedFlow - Hospital Operations & Resource Optimization (hackathon prototype)

A decision-support prototype for hospital resource management: patient arrivals -> priority -> constraint-based
resource allocation -> rolling-horizon re-optimization -> bottleneck detection -> analytics. Built for Hack-a-Matics (BMSCE).
**Not clinically validated; the triage layer is decision support, not diagnosis.**

## Run it (no dependencies - Python 3.10+ standard library only)

```bash
python app.py            # http://localhost:8000   (python app.py 9000 for another port)
python -m unittest discover -s tests -v          # 42 backend tests (about 8 s)
node tests/frontend_smoke.js http://localhost:8000   # optional: renders every page against a running server
```
Open the app in **two or three browser tabs**: log in as Head Nurse in one, and as a Nurse / Doctor in others. They all view the
same live simulation (the simulation runs on the server).

## What you get
* **Login** by role/name (no passwords - prototype only).
* **Head Nurse**: live overview, emergency-mode panel, bottleneck analysis with explainable, counterfactually evaluated
  recommendations (Apply button), hospital map (click a bed), patients (priority breakdown, timeline, admit + triage),
  doctors/nurses (mark unavailable/call in), resources & inventory forecast, **Modify resources** (with production-verification notice),
  optimization plan / objective / re-optimization log / strategy comparison, analytics (12 charts), daily report, algorithm page.
  Top bar: start / pause / resume / speed / +5 / +30 min / scenario / strategy / reset. Overview has a disruption console
  (surge, staff shortage, resource failure, unexpected treatment duration).
* **Nurse / Doctor**: current / next / then tasks with location, urgency, due time, required action, alerts - recomputed by the optimizer.
* **Legacy MVP** simulator preserved at `/legacy/` and `POST /api/simulate`.

## Architecture
```
app.py                     stdlib HTTP server + shared Session (background ticker) + JSON API
backend/config.py          every tunable (weights, thresholds, policies)
backend/models.py          Patient, Doctor, Nurse, Bed, EquipmentUnit, Consumable
backend/hospital.py        layout graph, roster, beds, equipment, stock, invariant checker
backend/expert.py          triage decision support (noisy-OR rules -> pathway)
backend/prediction.py      PredictionService: duration / demand / risk / resource-demand predictors (rules; ML-ready interface)
backend/priority.py        S_p priority engine
backend/allocation.py      Planner: hard constraints, serial scheduling with backfilling, cost-aware bundles, local search on J
backend/engine.py          hospital state engine: rolling horizon loop, commits, interruptions, resource changes, interventions
backend/emergency.py       NORMAL/WARNING/EMERGENCY/RECOVERY state machine
backend/bottleneck.py      bottleneck scores + counterfactual interventions
backend/analytics.py       overview, chart series, report, inventory forecast, strategy comparison
backend/scenarios.py       arrival profiles, patient generator, 6 scenario presets
backend/data_ingest.py     CSV validation/normalisation -> patients (bundled synthetic sample)
backend/db.py              SQLite persistence (runs, patients, staff, beds, resources, assignments, events, schedules, metrics, inventory tx)
backend/views.py           read models for nurse/doctor/head-nurse UI
backend/simulation.py, scenario.py, optimizer.py   original MVP (unchanged, used by /api/simulate)
frontend/                  no-build SPA (vanilla JS + SVG charts); frontend/legacy/ = original page
docs/ALGORITHM.md          the algorithm exactly as implemented;  docs/DATA.md  data provenance
tests/                     backend unit/integration tests, frontend render smoke test
```

## API (all under /api)
GET `state, roster, patients[?status=], patients/<id>, doctors, nurses, beds, map, resources, assignments, analytics, bottlenecks,
emergency, plan, events, report, config, scenarios, nurse/<id>, doctor/<id>, runs, data/sample`
POST `patients, simulation/{start|pause|resume|reset|speed|step}, optimization/run, diagnosis/evaluate, events/inject,
resources/modify, interventions/apply, compare, simulate (legacy)`

## Scenarios
`demo_day` (default), `normal_day`, `surge_test` (5 -> 15 patients/h), `staff_shortage`, `icu_failure`, `sample_dataset_day`.
Strategies: `urgency_only`, `urgency_wait`, `optimized_static`, `full`.

## Recommended demo flow (about 5 minutes)
1. Head Nurse tab -> Overview, scenario *Demo day*, strategy *MedFlow full optimization*. Press **Start** at 5 min/s.
2. Open a Nurse tab (e.g. Priya Sharma) and a Doctor tab (Dr. Arjun Rao): show current/next/then tasks changing.
3. Map page: beds fill up; click a bed. ~11:00 the scripted **surge** starts: queue grows, WARNING -> **EMERGENCY** banner with its trigger.
4. Overview: primary bottleneck with cause; optimizer auto-applies "call in / move staff" with the predicted wait change and reasons.
5. ~11:25 a treatment overruns: event log shows the overrun and the plan changes it caused (Optimization page -> re-optimization log).
6. ~12:10 two ER nurses become unavailable, ~13:00 an ICU bed fails: Overview shows the impact record (who was substituted / re-queued and why).
7. Try the disruption console live and **Resources -> Modify resources**.
8. Analytics, Daily Report (bottleneck episodes, inventory restock), Optimization -> *Run comparison*, Algorithm page.

See `docs/ALGORITHM.md` for the mathematics and known limitations.

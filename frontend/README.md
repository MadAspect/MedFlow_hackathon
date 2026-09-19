# MEDFLOW — Hospital Resource Management Simulator

> **This project is a simulation and decision-support prototype. It is not a clinical diagnosis, treatment, or patient-management system.** It uses synthetic patient data only.

MedFlow simulates how a hospital allocates limited resources (doctors, nurses, beds, ICU beds, operating rooms) to incoming patients, and compares three scheduling strategies on identical data.

## Problem statement

> Given the current patient queue and available doctors, nurses, beds, ICU beds, and operating rooms, which patient should be treated next, and how does the hospital perform under different scheduling strategies?

## Screenshots

_Placeholders — add captures from a demo run:_

| Control Room | Simulation + hospital view | Strategy Lab |
|---|---|---|
| `docs/control-room.png` | `docs/simulation.png` | `docs/strategy-lab.png` |

## Features

- **Control Room** – status, one-click demo, workflow checklist, latest KPIs and warnings.
- **Patients** – validated form (unique ID, urgency 1–5, arrival ≥ 0, treatment > 0, ≥ 1 resource), searchable table loaded from the database, example data (18 patients), delete / cancel.
- **Resources** – configure doctors, nurses, beds, ICU beds, operating rooms; save / load latest; total, allocated, available and utilization.
- **Simulation** – three strategies, duration, emergency surge, resource failure (resource, start, units), adjustable priority weights.
- **Interactive hospital view** – drag through time (minute-by-minute), resource cards (green < 70 %, yellow 70–89 %, red ≥ 90 %), Waiting → In treatment → Treated flow, critical/overdue highlighting, current allocations, per-patient **decision explanation**.
- **Results** – 9 KPI cards, 4 charts (queue length, utilization, wait distribution, treated vs waiting) and a strategy-comparison chart, all from real engine output.
- **Strategy Lab** – FCFS vs Urgency Only vs Dynamic Priority on the same input, best value highlighted, treatment-order diff, findings computed from the metrics.
- **History** – every run is stored; open any past run.
- **Graceful degradation** – without Supabase credentials the app runs on browser storage and says so.

## Mathematical model

For patient *i* at simulation time *T* (minutes):

| Symbol | Meaning |
|---|---|
| a_i | arrival time |
| u_i | urgency (1–5) |
| t_i | treatment duration |
| R_i | required resources (units per resource) |
| w_i(T) = T − a_i | waiting time (never negative) |
| r_i(T) = (u_i / 5) · (1 − e^(−w_i/30)) | deterioration risk in [0, 1) — a modelling assumption, not a clinical model |
| e_i | emergency priority (1 for surge arrivals, else 0) |

**Dynamic priority score**

```
S_i(T) = α·u_i + β·w_i + γ·r_i + δ·e_i        defaults: α = 4.0, β = 0.15, γ = 3.0, δ = 2.0
```

**Resource constraint** (never violated): for every resource *r* and minute, `Σ allocated_r ≤ capacity_r`.

**Simulation loop** (1-minute steps, `lib/simulation/engine.ts`): release finished treatments → admit arrivals → rank the queue with the chosen policy → walk the ranking and start every patient whose *whole* resource set is free (a blocked higher-ranked patient is skipped and recorded). Treatment is non-preemptive. The engine is deterministic.

**Emergency surge**: 10 deterministic synthetic emergency arrivals, one per minute from the surge start (mostly ICU cases).
**Resource failure**: the chosen number of units go offline at the failure start; a unit that is in use goes offline when its treatment finishes.

**Metrics** (`lib/simulation/metrics.ts`): patients treated; average, maximum and critical-patient wait (urgency ≥ 4; patients still queued count with their wait so far); queue length; patients remaining; utilization per resource (used unit-minutes ÷ nominal capacity-minutes); resource conflicts (distinct patients blocked by a shortage); safety-threshold breaches (wait > 30 min by default); bottlenecks (patient-minutes of waiting attributed to the *binding* shortage — the one that clears last; ties go to the scarcer resource).

## Scheduling strategies

1. **First-Come, First-Served** – arrival order. Fair by arrival, but urgent patients can wait behind minor cases.
2. **Urgency Only** – highest urgency first, ties by arrival. Protects critical cases but can starve low-urgency patients.
3. **Dynamic Priority** – highest S_i(T) first. Waiting time slowly lifts low-urgency patients.

Note: with the default weights, waiting has to differ by roughly 27 minutes per urgency level before Dynamic Priority outranks Urgency Only, so on short or lightly loaded runs the two can give identical results. Raise β under *Advanced* to see them diverge.

## Architecture

```
app/                 Next.js routes: / , /patients , /resources , /simulation , /history
components/          UI only (forms, tables, cards, charts, hospital view)
lib/
  simulation/        Pure, testable engine — no React, no database
    types.ts  policies.ts (score + strategies)  engine.ts  metrics.ts
    surge.ts  compare.ts  placeholder.ts  index.ts
  database.ts        Database interface + Supabase and browser-storage adapters
  supabase.ts        Browser client (refuses secret keys)
  runner.ts          "Run Simulation" pipeline: load → validate → run → save → update statuses
  validation.ts      Zod schemas and helpers
  store.tsx          React context that owns state and calls the database
  demo.ts            Synthetic example + demo data
supabase/            schema.sql, seed.sql
tests/               vitest suites (simulation, validation, database)
```

The engine's field names (`id`, `arrival_time`, `urgency`, `treatment_time`, `required_resources`, `start_time`, `end_time`, `wait_time`) and resource keys (`doctor`, `nurse`, `bed`, `icu_bed`, `operating_room`) match the repo-level README, so the Python `run_simulation` can be swapped in behind `runEngine()` later.

A **placeholder engine** (`lib/simulation/placeholder.ts`) exists for when the real engine is unavailable: set `NEXT_PUBLIC_SIMULATION_ENGINE=placeholder`. Its output is flagged everywhere with *"Placeholder simulation output — connect the scheduling engine to generate calculated results."* The real engine is the default.

## Technology choices

| Choice | Why |
|---|---|
| Next.js 16 + React 19 + TypeScript | One project for UI and logic; typed data shapes shared with the engine |
| Tailwind CSS 4, hand-written components | Accessible native controls, no component-library setup cost |
| Supabase Postgres | Real persistence with a free tier and a JS client; RLS for browser access |
| Zod | Validation shared by forms and tests |
| Recharts | Lightweight, works with React 19 |
| Lucide | Icons |
| Vitest | Fast unit tests for the pure engine |
| CSS transitions/keyframes only | No animation library needed; reduced-motion respected |

The simulation runs in the browser (it is a millisecond-scale computation), so no server or API keys beyond the publishable Supabase key are required.

## Database setup

1. Create a project at <https://supabase.com>.
2. Open **SQL editor**, paste and run `supabase/schema.sql`.
3. (Optional) run `supabase/seed.sql` for the default configuration and 18 example patients.

Tables: `patients`, `resource_configurations`, `simulation_runs`, `simulation_results`, `patient_allocations` (as specified, plus a few `jsonb` columns — full parameters, timeline, warnings, per-patient decision — so a run can be re-displayed after a refresh). Utilizations are stored as fractions 0–1.

**Security (read this):** there is no login in this prototype. `schema.sql` enables Row Level Security but adds a permissive demo policy so the browser's publishable key can read and write everything. **Anyone with your URL and key can change the data — use synthetic data only** and tighten the policies (e.g. per-user with Supabase Auth) before any real use. This is a hackathon prototype, not production-ready.

## Environment variables

Copy `.env.example` to `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Only the **publishable/anon** key belongs here. Never use a secret or service-role key — they bypass RLS. The app detects and ignores one placed by mistake. `.env*` files are git-ignored (except `.env.example`).

With no credentials (or an unreachable database) the header shows **Database: Disconnected (browser storage)** and everything still works, persisting in that browser only.

## Local installation and running

```bash
cd frontend
npm install
cp .env.example .env.local     # optional — skip to use browser storage
npm run dev                    # http://localhost:3000
```

Production check: `npm run build && npm start`. Type-check: `npm run typecheck`. Lint: `npm run lint`.

## Seeding demo data

- In the app: **Patients → Load Example Data** (18 patients), or **Control Room → Run demo scenario** (replaces patients, saves resources, runs the simulation).
- In Supabase: run `supabase/seed.sql`.

## Tests

```bash
npm test
```

57 tests cover: patient validation, duplicate detection, capacity constraints (including randomized scenarios checked against an independent replay), resource release, all three policies, waiting-time and utilization calculations, empty patient list, no resources, emergency surge, resource failure, input rejection (negative resources, invalid urgency), strategy-comparison fairness, persistence across a simulated refresh, and the demo scenario.

## AI tools used

Built with Claude Code (Anthropic Claude). Scheduling scores are computed by the deterministic engine in `lib/simulation/` — no AI model is called at runtime and none produces the priority scores or explanations.

## Animation library used

None. Small CSS transitions/keyframes only: page fade, KPI value pop, utilization-bar width, success confirmation, and a warning pulse on critical bottlenecks. All are disabled under `prefers-reduced-motion` and the app works without them.

## Assumptions

- All times are integer minutes; treatment is non-preemptive and holds every required resource for its full duration.
- Urgency ≥ 4 is "critical"; a wait over 30 minutes breaches the safety threshold (both adjustable).
- The risk curve, surge pattern and weights are illustrative modelling choices.
- Utilization is measured against nominal capacity.
- Patients that need more of a resource than exists can never be treated (the run warns about them).

## Limitations

- Not clinically validated; synthetic data only; no diagnosis or treatment guidance.
- No staff shifts, breaks, travel time, preemption, patient deterioration effects or stochastic arrivals — the model is deterministic.
- A short horizon rewards short treatments (they finish within the window), so "treated" counts can favour quick cases.
- The demo RLS policy is open; no authentication.
- Local (browser-storage) mode keeps only the latest 25 runs.
- The Python `backend/` stubs are unimplemented; the app uses the TypeScript engine.

## Team contributions

_Fill in before submission._ From the repo README: Dharansh – Python `run_simulation` interface; Dhimant – frontend. The TypeScript engine, database layer, UI and tests in this folder were produced with Claude Code.

## Demo script (2–3 minutes)

1. **Control Room** → *Run demo scenario* (3 doctors, 6 nurses, 8 beds, 2 ICU beds, 1 OR; 25 patients; 60 min; surge at 20; ICU bed fails at 35).
2. **Simulation** → in the hospital view drag the slider to minute ~10: *normal operation*, short queue.
3. Drag past minute 20: *queue grows during the surge*; drag to ~47: *ICU beds 2/2, red bottleneck banner*.
4. Click a patient in **Patient flow** → *decision explanation* shows the score terms and the resources free at that moment.
5. Point at the failure marker on the charts and the *Warnings* list: *resource failure* reduced ICU capacity and raised waits.
6. **Strategy Lab**: compare FCFS / Urgency Only / Dynamic Priority — highlighted best values, treatment-order differences, and the findings list; note the trade-offs (FCFS best max wait, Urgency Only best critical wait, Dynamic in between).
7. **Refresh** the page → patients, results and **History** are still there.

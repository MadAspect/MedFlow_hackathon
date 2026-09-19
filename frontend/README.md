# MEDFLOW — Hospital Resource Management Simulator

> **This project is a simulation and decision-support prototype. It is not a clinical diagnosis, treatment, or patient-management system.** It uses synthetic patient data only.

MedFlow simulates how a hospital allocates limited resources (doctors, nurses, beds, ICU beds, operating rooms) to incoming patients, and compares three scheduling strategies on identical data.

> **MedFlow scheduling, simulation, optimization, and result comparison are deterministic mathematical algorithms. No AI model is used in the simulation.**
> The simulation needs no AI API key and, apart from saving results to the database, runs entirely offline (no network calls, no randomness). Repeating a run with the same input gives identical output.

## Problem statement

> Given the current patient queue and available doctors, nurses, beds, ICU beds, and operating rooms, which patient should be treated next, and how does the hospital perform under different scheduling strategies?

## Screenshots

_Placeholders — add captures from a demo run:_

| Control Room | Simulation + hospital view | Compare and advice |
|---|---|---|
| `docs/control-room.png` | `docs/simulation.png` | `docs/strategy-lab.png` |

## Features

- **Control Room** – status, one-click demo, workflow checklist, latest KPIs and warnings.
- **Patients** – validated form (unique ID, urgency 1–5, arrival ≥ 0, treatment > 0, ≥ 1 resource), searchable table loaded from the database, example data (18 patients), delete / cancel.
- **Resources** – configure doctors, nurses, beds, ICU beds, operating rooms; save / load latest; total, allocated, available and utilization.
- **Simulation** – three strategies, duration, emergency surge, resource failure (resource, start, units), adjustable priority weights.
- **Interactive hospital view** – drag through time (minute-by-minute), resource cards (green < 70 %, yellow 70–89 %, red ≥ 90 %), Waiting → In treatment → Treated flow, critical/overdue highlighting, current allocations, per-patient **decision explanation**.
- **Results** – 9 KPI cards, 4 charts (queue length, utilization, wait distribution, treated vs waiting) and a strategy-comparison chart, all from real engine output.
- **Compare strategies and get advice** – First-Come, First-Served (the most common, basic approach, used as the baseline) vs Urgency Only vs Dynamic Priority on the same input. A recommended strategy chosen by priority-ordered checks, calculated advice for making the system more efficient (including *what if you add one more?* — one unit of each resource, re-simulated), a side-by-side table with the change against the baseline, average wait per urgency level ("who waits?"), and the treatment-order diff. When two strategies start patients in the same order it says so.
- **Patient timeline, playback and export** – a Gantt-style chart with one row per patient (waiting grey, waiting past the safety limit red, treatment blue) and a playhead that follows the hospital-view clock; click it to jump in time. Play / pause with four speeds animates the whole hospital view. Results can be downloaded as CSV (user-typed text is neutralised against spreadsheet formula injection).
- **Contrast scenario** – a deterministic example (button on the Simulation page) built so the three strategies visibly choose differently. It does not change the algorithms.
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
S_i(T) = α·u_i + β·w_i + γ·r_i + δ·e_i        defaults: α = 5.0, β = 0.35, γ = 2.0, δ = 3.0
```

**Resource constraint** (never violated): for every resource *r* and minute, `Σ allocated_r ≤ capacity_r`.

**Simulation loop** (discrete-event, `lib/simulation/engine.ts`): admit arrivals → release finished treatments → rank the queue with the chosen policy → walk the ranking and start every patient whose *whole* resource set is free (allocation is all-or-nothing; a blocked higher-ranked patient is skipped and recorded) → record the state → jump to the next event (next arrival, earliest completion, or the resource-failure start). Treatment is non-preemptive. The engine is deterministic.

**A bottleneck never ends the run.** A patient who waits for a resource simply stays queued; time advances to the earliest completion, that treatment's resources are released, and allocation is attempted again. The configured *duration* is the planned observation period only: if patients remain after it the run continues, and the result stores both `configured_duration` and `actual_completion_time`. Before returning, the engine verifies `waiting = 0`, `active treatments = 0` and `treated = total`. If that does not hold (for example a patient needs 2 ICU beds but only 1 exists) the result has `completed: false` and an explicit `error`, and the UI shows "Simulation error — not all patients were treated" instead of "Completed".

**Emergency surge**: 10 deterministic synthetic emergency arrivals, one per minute from the surge start (mostly ICU cases).
**Resource failure**: the chosen number of units go offline at the failure start; a unit that is in use goes offline when its treatment finishes.

**Metrics** (`lib/simulation/metrics.ts`): patients treated; average, maximum and critical-patient wait (urgency ≥ 4; patients still queued in an incomplete run count with their wait so far); queue length; patients remaining; utilization per resource (used unit-minutes ÷ nominal capacity-minutes over the longer of the planned duration and the actual completion time); resource conflicts (distinct patients blocked by a shortage); safety-threshold breaches (wait > 30 min by default); bottlenecks (patient-minutes of waiting attributed to the *binding* shortage — the one that clears last; ties go to the scarcer resource).

## Scheduling strategies

Every strategy uses the same patients, arrival times, treatment durations, resources, allocation and release logic; only the patient-selection order differs. Ties fall through to arrival time and then patient id (plain code-point comparison), so output is reproducible.

1. **First-Come, First-Served** – the normal baseline. Order: arrival time ↑, patient id ↑. Urgency and waiting time are ignored.
2. **Urgency Only** – order: urgency ↓, arrival ↑, id ↑. Protects critical cases but can starve low-urgency patients; waiting time is ignored.
3. **Dynamic Priority** – the efficient policy. Order: S_i(T) ↓, urgency ↓, arrival ↑, id ↑, where `S = 5.0·urgency + 0.35·waitingTime + 2.0·deteriorationRisk + 3.0·emergencyFlag`. The waiting-time term lets a low-urgency patient overtake newer, more urgent arrivals once they have waited long enough, so nobody is starved. The score is stored for every patient and shown in the decision explanation.

**Optional: protect blocked critical patients** (`reservation`, off by default, works with any strategy). Plain greedy backfilling lets a stream of small patients keep taking freed units, so a critical patient who needs several resources (e.g. two doctors) can wait indefinitely. With this option, when the top-ranked patient is critical, an emergency or already past the safety limit and cannot start, the earliest time they can start is computed from the running treatments and reserved: a lower-ranked patient may still start now only if they finish before that time or use only units that stay spare. This is EASY-style reservation backfilling. Measured on 300 random scenarios per load, it cut average critical-patient wait by about 8% but raised average wait and safety-limit breaches slightly (capacity sits idle while the reservation is held), so it is a trade-off rather than a free win and stays opt-in. Two other ideas were tried and dropped: reserving for every blocked head (worse on all averages), and a throughput bonus for short treatments (Smith's-rule style; under 1% effect because waiting and urgency dominate the score).

Note: with the default weights, waiting has to differ by roughly 57 minutes (20 ÷ 0.35) before a urgency-1 patient outranks a fresh urgency-5 arrival, so on short or lightly loaded runs Dynamic Priority and Urgency Only can produce the same order; the app then says "These strategies produced the same order for this scenario." Use the contrast scenario to see the strategies diverge.

### How the recommendation is decided (and why not one score)

First-Come, First-Served is the most common and basic approach, so it is the baseline. All three strategies are full, independent simulations of the same patients and resources; every number comes from those runs.

A single blended score hides trade-offs and depends on weights someone picked. Reordering a queue does not create capacity — it decides *who* waits — so a strategy can win a weighted sum while making low-urgency patients wait far longer. The recommendation therefore walks these checks in priority order (`lib/simulation/advice.ts`), and each check only separates strategies still tied on the ones above it:

1. every patient gets treated (fewest untreated)
2. fewest patients waiting past the safety limit
3. shortest average wait for critical patients
4. shortest longest wait (fairness)
5. shortest average wait

Wait times within 1 minute or 5% of the best count as tied. If nothing separates the strategies, First-Come, First-Served is kept. The page also shows the average wait per urgency level so the price paid by low-urgency patients is visible, and states the trade-off against the baseline in words.

The advice list is derived from the recommended strategy's run: unfinished patients, the best *tested* configuration (one extra unit of doctor, nurse, general bed, ICU bed or operating room, each fully re-simulated — not an exhaustive search), mostly-idle resources next to a bottleneck, safety-limit breaches, resources at ≥ 90% use, and Dynamic Priority behaving exactly like Urgency Only. The "best tested configuration" is the lowest objective score, which is still calculated for that purpose:

```
objectiveScore = 1.0·totalWaitingTime + 4.0·criticalPatientWaitingTime
               + 10000·patientsRemaining + 10000·resourceOverload + 0.5·maximumWaitingTime
```

but the page reports the resulting minutes saved rather than the score.

## Architecture

```
app/                 Next.js routes: / , /patients , /resources , /simulation , /history
components/          UI only (forms, tables, cards, charts, hospital view)
lib/
  simulation/        Pure, testable engine — no React, no database
    types.ts  policies.ts (score + strategies)  engine.ts  metrics.ts  efficiency.ts (resource what-ifs)
    surge.ts  compare.ts  advice.ts (recommendation + advice)  placeholder.ts  index.ts
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

91 tests cover: patient validation, duplicate detection, capacity constraints (including randomized scenarios checked against an independent replay), resource release, all three policies, waiting-time and utilization calculations, empty patient list, no resources, emergency surge, resource failure, input rejection (negative resources, invalid urgency), strategy-comparison fairness, persistence across a simulated refresh, and the demo scenario. `tests/scheduling.test.ts` adds the selection rules of each policy, starvation prevention, bottleneck continuation, completion beyond the planned duration, the completion guarantee and explicit errors, the normal-vs-efficient comparison, the contrast scenario, determinism, and a check that the simulation sources make no network calls and contain no AI code.

There are no browser (end-to-end) tests in this repository.

## AI tools used

Built with Claude Code (Anthropic Claude). Scheduling scores are computed by the deterministic engine in `lib/simulation/` — no AI model is called at runtime and none produces the priority scores, the simulation, the comparison or the explanations.

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
6. **Compare strategies and get advice** (bottom of the Simulation page): FCFS (the common baseline) vs Urgency Only vs Dynamic Priority — the recommended strategy and why, the advice list, *what if you add one more?*, and the who-waits chart that shows the trade-off for low-urgency patients.
7. **Refresh** the page → patients, results and **History** are still there.

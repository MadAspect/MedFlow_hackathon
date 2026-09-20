# WAITLESS — Hospital Resource Management Simulator

> **This is a simulation and decision-support prototype, not a clinical diagnosis, treatment or patient-management system.** It uses synthetic patient data only.

Waitless simulates how a hospital allocates limited resources (doctors, nurses, beds, ICU beds, operating rooms, medicines and equipment) to incoming patients, and compares four scheduling strategies on identical data.

> **All scheduling, simulation, optimization, metrics and comparison are deterministic mathematics. No AI model runs at runtime.** No AI API key is needed, and running the same input twice gives identical output.

**Question it answers:** given the current patient queue and the available resources, which patient should be treated next, and how does the hospital perform under different strategies?

## Features

- **Control Room** – one-click demo (walk-ins, appointments and ambulances), workflow checklist, latest KPIs and warnings.
- **Patients, Appointments, Ambulances** – validated forms, searchable tables, example data, advance booking with capacity checks.
- **Resources** – configure doctors, nurses, beds, ICU beds and operating rooms.
- **Inventory** – medicine stock (with minimum thresholds) and equipment (owned, free, in use, under maintenance). Optional stock constraints make patients wait for the items they need.
- **Staff** – roster with roles, departments, shifts and availability; marking someone unavailable changes the schedule.
- **Simulation** – four strategies, emergency surge, resource failure, adjustable weights, minute-by-minute hospital view with playback, patient timeline, per-patient decision explanation, and adding a patient mid-run.
- **Compare and advise** – all strategies run on the same input, with a recommended strategy, "what if you add one more?" what-ifs, and a run summary.
- **History** – every run is stored and can be reopened; results export to CSV.
- **Light / dark / system theme**, and a browser-storage fallback when no database is configured.

## Scheduling strategies

Every strategy uses the same allocation and release logic; only the order patients are picked in differs. Ties fall back to arrival time, then patient id, so results are reproducible.

1. **First-Come, First-Served** – the baseline. Arrival time only.
2. **Urgency Only** – urgency first, then arrival. Protects critical cases but can starve low-urgency patients.
3. **Dynamic Priority** – score `S = 5.0·urgency + 0.35·wait + 2.0·deteriorationRisk + 3.0·emergency`. Waiting time lets low-urgency patients eventually overtake newer, more urgent arrivals, so nobody is starved.
4. **Harm-Density Index** – a weight-free policy that ranks by harm relieved per priced resource-hour (a "bang per buck" rule).

Allocation is all-or-nothing and non-preemptive: a patient starts only when every resource they need is free, and capacity is never exceeded. A bottleneck never ends the run; blocked patients stay queued until resources free up. The **Algorithms** tab in the app shows the full formulas.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org) **20.9 or newer** (includes npm)
- Git
- *Optional:* a free [Supabase](https://supabase.com) project, if you want data saved in a database. Without one, the app stores everything in your browser.

### Steps

```bash
# 1. Get the code
git clone https://github.com/MadAspect/MedFlow_hackathon.git
cd MedFlow_hackathon/frontend

# 2. Install dependencies
npm install

# 3. (Optional) configure environment variables
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local

# 4. Start the app
npm run dev
```

Open <http://localhost:3000>, go to the **Control Room** and click **Run demo scenario**.

Skip step 3 to run on browser storage. The header will say **Browser storage**.

### Environment variables (`frontend/.env.local`)

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your Supabase **publishable (anon)** key |
| `NEXT_PUBLIC_ENABLE_STOCK_CONSTRAINTS` | Set to `true` so simulations respect medicine and equipment stock (off by default) |
| `NEXT_PUBLIC_SIMULATION_ENGINE` | Set to `placeholder` to force the clearly labelled placeholder engine (default is the real engine) |

Use only the publishable key. Never put a secret or service-role key here, because it bypasses Row Level Security (the app detects and ignores one). `.env*` files are git-ignored except `.env.example`. Restart `npm run dev` after changing any variable.

### Database setup (optional)

1. Create a project at <https://supabase.com>.
2. In the **SQL editor**, run `frontend/supabase/schema.sql`.
3. *(Optional)* run `frontend/supabase/seed.sql` for the default configuration and 18 example patients.
4. Already set up an older version? Run `frontend/supabase/migrations/20260920_inventory_staff.sql` once. It is additive and touches no existing data.
5. Add your URL and publishable key to `.env.local` and restart the dev server.

> **Security:** this prototype has no login. `schema.sql` enables Row Level Security with a permissive demo policy, so anyone with your URL and key can read and write the data. Use synthetic data only, and tighten the policies (for example with Supabase Auth) before any real use.

### Other commands (run from `frontend/`)

| Command | What it does |
|---|---|
| `npm run build` then `npm start` | Production build and server |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright, uses installed Microsoft Edge; set `E2E_CHANNEL=chrome` for Chrome). Runs against browser storage and never touches your database. |

## Project structure

```
frontend/
  app/          Next.js routes: / , /patients , /appointments , /ambulances , /resources ,
                /inventory , /staff , /simulation , /history
  components/   UI (forms, tables, charts, hospital view, dialogs)
  lib/
    simulation/ Pure, testable engine: policies, engine, metrics, surge, compare, advice
    database.ts Supabase and browser-storage adapters
    inventory.ts, staff.ts, treatments.ts, workload.ts, summary.ts, demo.ts, store.tsx, ...
  supabase/     schema.sql, seed.sql, migrations/
  tests/        Vitest suites
  e2e/          Playwright browser tests
```

Tech stack: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres), Zod, Recharts, Lucide, Vitest, Playwright. The simulation runs in the browser, so no server or API keys are needed beyond the optional Supabase key.

## Assumptions and limitations

- All times are integer minutes. Urgency ≥ 4 counts as critical, and a wait over 30 minutes breaches the safety threshold (both adjustable).
- The deterioration curve, surge pattern, standard treatment stock sets and weights are illustrative modelling choices, not clinical guidance.
- Not clinically validated. Synthetic data only.
- No shifts or breaks in the scheduler, travel time, preemption or stochastic arrivals. A single shared resource pool (no separate departments).
- The what-if search tests one extra unit of each resource. It reports the best result within that small search space, not a proven optimum.
- The demo database policy is open (no authentication).
- In browser-storage mode only the latest 25 runs are kept.

-- MedFlow database schema (Supabase Postgres).
-- Paste into the Supabase SQL editor and run once. Safe to re-run.
--
-- HACKATHON PROTOTYPE: there is no login, so the policies at the bottom let the
-- browser's anon/publishable key read and write every table. Do not store real
-- patient data here. Tighten the policies (e.g. `using (auth.uid() = owner_id)`)
-- before any real use.

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------
create table if not exists public.patients (
  id                 uuid primary key default gen_random_uuid(),
  patient_id         text not null,
  condition          text not null,
  arrival_time       integer not null check (arrival_time >= 0),
  urgency            integer not null check (urgency between 1 and 5),
  treatment_time     integer not null check (treatment_time > 0),
  -- units needed of each resource, e.g. {"doctor":1,"nurse":2,"icu_bed":1}
  required_resources jsonb not null default '{}'::jsonb
                     check (required_resources <> '{}'::jsonb),
  status             text not null default 'waiting'
                     check (status in ('waiting','in_treatment','treated','critical_waiting','cancelled')),
  priority_score     double precision not null default 0,
  created_at         timestamptz not null default now()
);

-- Patient IDs are unique, ignoring case ("p001" and "P001" clash).
create unique index if not exists patients_patient_id_lower_key
  on public.patients (lower(patient_id));

-- ---------------------------------------------------------------------------
-- resource_configurations (append-only; the newest row is the current config)
-- ---------------------------------------------------------------------------
create table if not exists public.resource_configurations (
  id              uuid primary key default gen_random_uuid(),
  doctors         integer not null check (doctors >= 0),
  nurses          integer not null check (nurses >= 0),
  beds            integer not null check (beds >= 0),
  icu_beds        integer not null check (icu_beds >= 0),
  operating_rooms integer not null check (operating_rooms >= 0),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- simulation_runs
-- ---------------------------------------------------------------------------
create table if not exists public.simulation_runs (
  id               uuid primary key default gen_random_uuid(),
  strategy         text not null check (strategy in ('fcfs','urgency','dynamic')),
  simulation_time  integer not null check (simulation_time > 0),
  emergency_surge  boolean not null default false,
  resource_failure boolean not null default false,
  failed_resource  text check (failed_resource in ('doctor','nurse','bed','icu_bed','operating_room')),
  status           text not null default 'running' check (status in ('running','completed','failed')),
  created_at       timestamptz not null default now(),
  -- extras so a run can be re-displayed after a page refresh
  parameters       jsonb not null default '{}'::jsonb,  -- {params, resources}
  engine           text not null default 'unknown',
  is_placeholder   boolean not null default false
);

-- ---------------------------------------------------------------------------
-- simulation_results (utilizations are fractions 0..1)
-- ---------------------------------------------------------------------------
create table if not exists public.simulation_results (
  id                         uuid primary key default gen_random_uuid(),
  simulation_run_id          uuid not null references public.simulation_runs(id) on delete cascade,
  patients_treated           integer not null default 0,
  average_waiting_time       double precision not null default 0,
  maximum_waiting_time       double precision not null default 0,
  critical_waiting_time      double precision not null default 0,
  doctor_utilization         double precision not null default 0,
  nurse_utilization          double precision not null default 0,
  bed_utilization            double precision not null default 0,
  icu_utilization            double precision not null default 0,
  operating_room_utilization double precision not null default 0,
  patients_remaining         integer not null default 0,
  created_at                 timestamptz not null default now(),
  -- extras for the charts and the hospital view
  metrics                    jsonb not null default '{}'::jsonb,
  timeline                   jsonb not null default '[]'::jsonb,
  warnings                   jsonb not null default '[]'::jsonb
);
create index if not exists simulation_results_run_idx on public.simulation_results (simulation_run_id);

-- ---------------------------------------------------------------------------
-- patient_allocations (one row per patient per run)
-- patient_id is the patient's text ID, not a foreign key: surge patients are
-- synthetic and stored patients can be deleted after a run.
-- ---------------------------------------------------------------------------
create table if not exists public.patient_allocations (
  id                  uuid primary key default gen_random_uuid(),
  simulation_run_id   uuid not null references public.simulation_runs(id) on delete cascade,
  patient_id          text not null,
  status              text not null
                      check (status in ('treated','in_treatment','waiting','critical_waiting','not_arrived')),
  priority_score      double precision not null default 0,
  allocated_resources jsonb not null default '{}'::jsonb,
  start_time          integer,
  completion_time     integer,
  waiting_time        integer not null default 0,
  -- extras used by the decision explanation
  arrival_time        integer not null default 0,
  urgency             integer not null default 1,
  condition           text not null default '',
  treatment_time      integer not null default 1,
  emergency           boolean not null default false,
  decision            jsonb
);
create index if not exists patient_allocations_run_idx on public.patient_allocations (simulation_run_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (demo policies — see the warning at the top of this file)
-- ---------------------------------------------------------------------------
alter table public.patients                enable row level security;
alter table public.resource_configurations enable row level security;
alter table public.simulation_runs         enable row level security;
alter table public.simulation_results      enable row level security;
alter table public.patient_allocations     enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'patients','resource_configurations','simulation_runs',
    'simulation_results','patient_allocations'
  ] loop
    execute format('drop policy if exists "medflow_demo_access" on public.%I', t);
    execute format(
      'create policy "medflow_demo_access" on public.%I for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

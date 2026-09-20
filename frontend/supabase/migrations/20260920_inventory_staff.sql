-- Adds medicine/equipment stock, the staff roster and availability history.
-- Additive only: no existing table or row is touched, and every statement is safe to re-run.
-- Run once in the Supabase SQL editor on an existing database. New databases get the same
-- block from supabase/schema.sql.
--
-- HACKATHON PROTOTYPE: like the rest of the schema, the policies at the bottom let the browser's
-- anon/publishable key read and write these tables. Do not store real data; tighten before real use.
-- Never put a service-role key in the browser.

-- ---------------------------------------------------------------------------
-- medicines (status is derived in the app: out of stock <= 0, low <= minimum_threshold)
-- ---------------------------------------------------------------------------
create table if not exists public.medicines (
  id                text primary key,
  name              text not null,
  category          text not null,
  quantity          integer not null check (quantity >= 0),
  minimum_threshold integer not null default 0 check (minimum_threshold >= 0),
  unit              text not null,
  expiry_date       date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists medicines_name_idx     on public.medicines (lower(name));
create index if not exists medicines_category_idx on public.medicines (category);

-- ---------------------------------------------------------------------------
-- equipment (unavailable when available_quantity <= 0 or maintenance_status = 'maintenance')
-- ---------------------------------------------------------------------------
create table if not exists public.equipment (
  id                 text primary key,
  name               text not null,
  category           text not null,
  quantity           integer not null check (quantity >= 0),
  available_quantity integer not null check (available_quantity >= 0),
  in_use_quantity    integer not null default 0 check (in_use_quantity >= 0),
  maintenance_status text not null default 'operational'
                     check (maintenance_status in ('operational','maintenance')),
  minimum_threshold  integer not null default 0 check (minimum_threshold >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (available_quantity + in_use_quantity <= quantity)
);
create index if not exists equipment_name_idx     on public.equipment (lower(name));
create index if not exists equipment_category_idx on public.equipment (category);

-- ---------------------------------------------------------------------------
-- staff (doctors, nurses, technicians, other). Which patient someone is treating is derived from
-- the current run, so it is not stored here.
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  id                  text primary key,
  name                text not null,
  role                text not null check (role in ('doctor','nurse','technician','other')),
  department          text not null,
  specialization      text,
  shift_start         text not null check (shift_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  shift_end           text not null check (shift_end   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  availability_status text not null default 'available'
                      check (availability_status in ('available','busy','on_leave','unavailable','training')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists staff_role_idx         on public.staff (role);
create index if not exists staff_department_idx   on public.staff (department);
create index if not exists staff_availability_idx on public.staff (availability_status);

-- ---------------------------------------------------------------------------
-- staff_availability_events (append-only history; effective_time is a simulation minute)
-- staff_id is not a foreign key so the history survives a person being removed.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_availability_events (
  id              uuid primary key default gen_random_uuid(),
  staff_id        text not null,
  previous_status text not null
                  check (previous_status in ('available','busy','on_leave','unavailable','training')),
  new_status      text not null
                  check (new_status in ('available','busy','on_leave','unavailable','training')),
  effective_time  integer not null default 0 check (effective_time >= 0),
  reason          text not null default '',
  created_at      timestamptz not null default now()
);
create index if not exists staff_availability_events_staff_idx
  on public.staff_availability_events (staff_id, created_at desc);

-- ---------------------------------------------------------------------------
-- patient_stock_requirements: what a patient's treatment needs from stock.
-- patient_id is the patient's text ID (like patient_allocations), so surge patients and deleted
-- patients do not need a foreign key. item_id points at medicines.id or equipment.id.
-- ---------------------------------------------------------------------------
create table if not exists public.patient_stock_requirements (
  id                uuid primary key default gen_random_uuid(),
  patient_id        text not null,
  item_type         text not null check (item_type in ('medicine','equipment')),
  item_id           text not null,
  quantity_required integer not null check (quantity_required > 0),
  unique (patient_id, item_type, item_id)
);
create index if not exists patient_stock_requirements_patient_idx
  on public.patient_stock_requirements (patient_id);

-- ---------------------------------------------------------------------------
-- Row Level Security (demo policies, same as the rest of the schema)
-- ---------------------------------------------------------------------------
alter table public.medicines                  enable row level security;
alter table public.equipment                  enable row level security;
alter table public.staff                      enable row level security;
alter table public.staff_availability_events  enable row level security;
alter table public.patient_stock_requirements enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'medicines','equipment','staff','staff_availability_events','patient_stock_requirements'
  ] loop
    execute format('drop policy if exists "medflow_demo_access" on public.%I', t);
    execute format(
      'create policy "medflow_demo_access" on public.%I for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';

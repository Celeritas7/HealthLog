-- ============================================================
-- HealthLog — Supabase schema
-- All tables prefixed healthlog_ (lowercase, unquoted).
-- Run this whole file in the Supabase SQL editor
-- (Project → SQL editor → New query → paste → Run).
-- ============================================================

-- ---------- CLINICS ----------
create table if not exists healthlog_clinics (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,           -- swap to uuid references auth.users(id) for real auth
  name       text not null,
  phone      text,
  address    text,
  created_at timestamptz default now(),
  unique (user_id, name)
);

-- ---------- VISITS ----------
create table if not exists healthlog_visits (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  clinic_id    uuid references healthlog_clinics(id) on delete set null,
  clinic_name  text not null,         -- denormalized: what the app displays
  doctor       text,
  visit_date   date not null,
  concern      text not null,         -- health concern
  notes        text,                  -- diagnosis / advice
  follow_up    date,                  -- optional follow-up date
  cost_consult numeric(10,2) not null default 0,
  cost_meds    numeric(10,2) not null default 0,
  cost_other   numeric(10,2) not null default 0,  -- tests / other
  created_at   timestamptz default now()
);
create index if not exists healthlog_visits_user_date on healthlog_visits (user_id, visit_date desc);

-- ---------- MEDICINES (prescribed per visit) ----------
create table if not exists healthlog_medicines (
  id        uuid primary key default gen_random_uuid(),
  visit_id  uuid not null references healthlog_visits(id) on delete cascade,
  name      text not null,
  dose      text,                      -- e.g. '500 mg'
  slots     text[] not null default '{morning}',  -- morning | noon | evening | night
  days      int  not null default 1 check (days >= 1),  -- course length from visit_date
  sort      int  default 0
);
create index if not exists healthlog_medicines_visit on healthlog_medicines (visit_id);

-- ---------- DOSE LOG (taken / not taken per day+slot) ----------
create table if not exists healthlog_dose_logs (
  user_id     text not null,
  medicine_id uuid not null references healthlog_medicines(id) on delete cascade,
  log_date    date not null,
  slot        text not null check (slot in ('morning','noon','evening','night')),
  taken       boolean not null default true,
  updated_at  timestamptz default now(),
  primary key (user_id, medicine_id, log_date, slot)
);

-- ---------- ROW LEVEL SECURITY ----------
alter table healthlog_clinics    enable row level security;
alter table healthlog_visits     enable row level security;
alter table healthlog_medicines  enable row level security;
alter table healthlog_dose_logs  enable row level security;

-- Demo policies: anyone with the anon key can read/write.
-- For real multi-user auth: make user_id `uuid default auth.uid()`,
-- and replace `using (true)` with `using (user_id = auth.uid())`.
create policy "all clinics"   on healthlog_clinics   for all using (true) with check (true);
create policy "all visits"    on healthlog_visits    for all using (true) with check (true);
create policy "all medicines" on healthlog_medicines for all using (true) with check (true);
create policy "all dose logs" on healthlog_dose_logs for all using (true) with check (true);

-- ---------- USEFUL VIEWS ----------
-- Total expense per visit
create or replace view healthlog_visit_totals as
select v.*, (v.cost_consult + v.cost_meds + v.cost_other) as total
from healthlog_visits v;

-- Monthly spend per user
create or replace view healthlog_monthly_spend as
select user_id,
       date_trunc('month', visit_date)::date as month,
       sum(cost_consult + cost_meds + cost_other) as total
from healthlog_visits
group by 1, 2;

-- Active medicine courses on a given day (join with current_date in queries)
create or replace view healthlog_active_courses as
select m.*, v.user_id, v.clinic_name, v.visit_date as start_date,
       (v.visit_date + (m.days - 1)) as end_date
from healthlog_medicines m
join healthlog_visits v on v.id = m.visit_id;

-- ---------- SAMPLE SEED (optional — mirrors the prototype's demo data) ----------
-- insert into healthlog_visits (user_id, clinic_name, doctor, visit_date, concern, notes, cost_consult, cost_meds)
-- values ('demo', 'CityCare Family Clinic', 'Dr. Meera Nair', current_date - 6,
--         'Sore throat & fever', 'Strep test negative. Rest, fluids, 7-day antibiotic course.', 40, 22);

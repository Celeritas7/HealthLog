-- ============================================================
-- HealthLog — symptoms, food remedies, dismissals
-- ALREADY APPLIED to project wylxvmkcrexwfpjpbhyy; kept here so the repo
-- carries the DDL that healthlog-remedies.js and the weather-warnings
-- migration depend on. Do not re-run on that project.
--
-- Sections 1–2 are the applied migrations verbatim
-- (healthlog_symptoms_and_food_remedies 20261023041432,
--  healthlog_food_remedies_column_notes 20261024011333).
-- Section 3 is healthlog_dismissals as it exists live, reconstructed from
-- the catalog (its migration is not in schema_migrations).
-- ============================================================

-- ---------- 1. healthlog_symptoms_and_food_remedies ----------

-- Symptom episodes: what the weather correlation and remedy links hang off
create table public.healthlog_symptoms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  local_id    text,
  symptom     text not null,                 -- e.g. 'cough', 'sore throat', 'throat itch'
  started_on  date not null,
  ended_on    date,
  severity    text check (severity in ('mild','moderate','severe')),
  fever       boolean,
  notes       text,
  source      text not null default 'device',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, local_id)
);

-- Food used as a remedy; sits alongside medicines/doses in the timeline
create table public.healthlog_food_remedies (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  local_id      text,
  name          text not null,
  kind          text not null check (kind in ('dish','drink','restaurant_meal')),
  symptom       text,                        -- free text, e.g. 'cough'
  symptom_id    uuid references public.healthlog_symptoms(id) on delete set null,
  taken_on      date not null,
  taken_at      time,
  time_of_day   text,                        -- e.g. 'lunch', 'before bed'
  effect        text check (effect in ('none','some','good')),
  relief_hours  numeric,
  notes         text,
  -- optional cross-app references (no FK: Akatsuki owns cross-app links)
  fd_dish_id    uuid,                        -- food_department_dishes.id
  setu_spot_id  uuid,                        -- setu_spots.id
  place_name    text,
  source        text not null default 'device',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, local_id)
);

create index healthlog_symptoms_user_started on public.healthlog_symptoms (user_id, started_on);
create index healthlog_food_remedies_user_taken on public.healthlog_food_remedies (user_id, taken_on);
create index healthlog_food_remedies_symptom on public.healthlog_food_remedies (symptom_id);

alter table public.healthlog_symptoms enable row level security;
alter table public.healthlog_food_remedies enable row level security;

create policy "own healthlog_symptoms" on public.healthlog_symptoms
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own healthlog_food_remedies" on public.healthlog_food_remedies
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- 2. healthlog_food_remedies_column_notes ----------
comment on column public.healthlog_food_remedies.setu_spot_id is 'setu_food_notes.id (NOT setu_spots.id) — as returned by setu_comfort_spots_near(). No FK: Akatsuki owns cross-app links.';
comment on column public.healthlog_food_remedies.fd_dish_id is 'food_department_dishes.id — to be read via hub view akatsuki_food_dish_ingredients once Food Department is on the hub. No FK.';

-- ---------- 3. healthlog_dismissals (reconstructed) ----------
-- One row per dismissed inbox item. Keys the app writes:
--   remedy-help:<remedy local_id>   "Did it help?" skipped (alert_date = taken_on)
--   warnings:<run_date>             evening weather note dismissed
create table public.healthlog_dismissals (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  alert_key   text not null,
  alert_date  date not null,
  primary key (user_id, alert_key, alert_date)
);
alter table public.healthlog_dismissals enable row level security;
create policy "own healthlog_dismissals" on public.healthlog_dismissals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

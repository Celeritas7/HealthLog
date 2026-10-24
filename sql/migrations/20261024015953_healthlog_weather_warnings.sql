-- ============================================================
-- HealthLog — evening weather warnings (brief v1 §1–2, hub R045)
-- Migration name: healthlog_weather_warnings
--
-- Reads (never writes) akatsuki_weather — the forecast, key 'here' if fresh,
-- else 'place:home' — and akatsuki_weather_daily (history, for "yesterday"
-- when a rule looks at today). Writes healthlog_* tables only.
-- healthlog_warnings_run() is run by pg_cron as postgres (bypasses RLS), so
-- every query filters user_id itself. The cron job is a separate migration.
-- ============================================================

-- ---------- RULES ----------
create table if not exists public.healthlog_alert_rules (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  enabled       boolean not null default true,
  field         text not null check (field in (
                  'rh_min_pct','rh_mean_pct','pressure_hpa_mean','tmax_c','tmin_c','precip_mm','wind_max_ms',
                  'temp_gap',          -- tmax_c − tmin_c, same day
                  'pressure_change',   -- day's pressure_hpa_mean − the day before
                  'tmax_change')),     -- day's tmax_c − the day before
  op            text not null check (op in ('lt','gt')),   -- change fields: gt = a rise, lt = a drop
  threshold     numeric not null,                          -- in the field's unit
  day           smallint not null default 1 check (day in (0, 1)),  -- 1 = tomorrow, 0 = today
  symptom       text,                                      -- null = general; text = tied to that symptom
  message       text not null,                             -- template, {value} = the reading
  tip           text,
  cooldown_days integer not null default 1 check (cooldown_days >= 1),
  priority      smallint not null default 100,             -- lower shows first (after symptom-tied rules)
  starter_key   text,                                      -- set on the starter rules only
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, starter_key)
);
create index if not exists healthlog_alert_rules_user on public.healthlog_alert_rules (user_id) where enabled;

alter table public.healthlog_alert_rules enable row level security;
create policy "own healthlog_alert_rules" on public.healthlog_alert_rules
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- EVENTS (one per rule per evening run; the app's inbox reads these) ----------
create table if not exists public.healthlog_alert_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  rule_id      uuid not null references public.healthlog_alert_rules(id) on delete cascade,
  run_date     date not null,          -- JST date of the 18:00 run
  for_date     date not null,          -- the day the warning is about, in the place's time zone
  weather_key  text not null check (weather_key in ('here', 'place:home')),
  place_label  text not null,          -- what the line shows: 'Here' or 'Home'
  field        text not null,
  op           text not null,
  threshold    numeric not null,
  value        numeric not null,
  today_value  numeric,                -- the day before for_date, for "(today 58%)"
  symptom      text,
  rank         smallint not null check (rank between 1 and 3),
  message      text not null,          -- the rule's template, filled in
  line         text not null,          -- "[Tomorrow · Home] Dry air: min humidity 32% (today 58%). Warm drinks, mask outside."
  created_at   timestamptz not null default now(),
  unique (rule_id, run_date)
);
create index if not exists healthlog_alert_events_user_run on public.healthlog_alert_events (user_id, run_date desc);

-- Read-only for the app; only healthlog_warnings_run() writes.
alter table public.healthlog_alert_events enable row level security;
create policy "own healthlog_alert_events read" on public.healthlog_alert_events
  for select to authenticated using (auth.uid() = user_id);

-- ---------- STARTER RULES ----------
create or replace function public.healthlog_starter_rules()
returns table (starter_key text, name text, field text, op text, threshold numeric, message text, tip text, priority smallint)
language sql immutable set search_path = public
as $$
  values
    ('dry-air',       'Dry air',        'rh_min_pct',      'lt',  35, 'Dry air tomorrow (min humidity {value}%)',   'Warm drinks, mask outside, humidifier at night',      1::smallint),
    ('pressure-drop', 'Pressure drop',  'pressure_change', 'lt',  -6, 'Pressure falls {value} hPa tomorrow',        'Take it easy, keep water and any usual remedy handy', 2::smallint),
    ('day-night-gap', 'Day–night gap',  'temp_gap',        'gt',  12, 'Big day–night swing tomorrow ({value} °C)',  'Carry a layer',                                      3::smallint),
    ('sudden-heat',   'Sudden heat',    'tmax_change',     'gt',   6, 'Much warmer tomorrow (+{value} °C)',         'Drink more water, lighter clothes',                  4::smallint)
$$;

-- Users who already use HealthLog get the four starters now.
insert into public.healthlog_alert_rules (user_id, name, field, op, threshold, message, tip, priority, starter_key)
select u.user_id, s.name, s.field, s.op, s.threshold, s.message, s.tip, s.priority, s.starter_key
from (
  select user_id from public.healthlog_visits
  union select user_id from public.healthlog_symptoms
  union select user_id from public.healthlog_food_remedies
  union select user_id from public.healthlog_settings
) u
cross join public.healthlog_starter_rules() s
on conflict (user_id, starter_key) do nothing;

-- Anyone else: the app calls this after sign-in; it only adds the starters
-- when the user has no rules at all (so a deleted starter stays deleted).
create or replace function public.healthlog_add_starter_rules()
returns integer
language sql security invoker set search_path = public
as $$
  with ins as (
    insert into public.healthlog_alert_rules (user_id, name, field, op, threshold, message, tip, priority, starter_key)
    select auth.uid(), s.name, s.field, s.op, s.threshold, s.message, s.tip, s.priority, s.starter_key
    from public.healthlog_starter_rules() s
    where auth.uid() is not null
      and not exists (select 1 from public.healthlog_alert_rules r where r.user_id = auth.uid())
    on conflict (user_id, starter_key) do nothing
    returning 1
  )
  select count(*)::integer from ins
$$;
revoke execute on function public.healthlog_add_starter_rules() from public, anon;
grant execute on function public.healthlog_add_starter_rules() to authenticated;

-- ---------- TEXT ----------
-- A reading with its unit: 32%, 1008 hPa, 12.5 °C, 4 mm, 9 m/s.
create or replace function public.healthlog_fmt_reading(p_field text, v numeric)
returns text
language sql immutable set search_path = public
as $$
  select case
    when v is null then null
    when p_field in ('rh_min_pct', 'rh_mean_pct') then round(v)::text || '%'
    when p_field in ('pressure_hpa_mean', 'pressure_change') then trim_scale(round(v, 1))::text || ' hPa'
    when p_field = 'precip_mm' then trim_scale(round(v, 1))::text || ' mm'
    when p_field = 'wind_max_ms' then trim_scale(round(v, 1))::text || ' m/s'
    else trim_scale(round(v, 1))::text || ' °C'
  end
$$;

-- "min humidity 32%", "pressure falls 7 hPa", "high 6.5 °C warmer" …
create or replace function public.healthlog_warning_phrase(p_field text, v numeric)
returns text
language sql immutable set search_path = public
as $$
  select case p_field
    when 'rh_min_pct'        then 'min humidity ' || healthlog_fmt_reading(p_field, v)
    when 'rh_mean_pct'       then 'humidity ' || healthlog_fmt_reading(p_field, v)
    when 'pressure_hpa_mean' then 'pressure ' || healthlog_fmt_reading(p_field, v)
    when 'tmax_c'            then 'high ' || healthlog_fmt_reading(p_field, v)
    when 'tmin_c'            then 'low ' || healthlog_fmt_reading(p_field, v)
    when 'precip_mm'         then 'rain ' || healthlog_fmt_reading(p_field, v)
    when 'wind_max_ms'       then 'wind up to ' || healthlog_fmt_reading(p_field, v)
    when 'temp_gap'          then 'day–night swing ' || healthlog_fmt_reading(p_field, v)
    when 'pressure_change'   then 'pressure ' || (case when v < 0 then 'falls ' else 'rises ' end) || healthlog_fmt_reading(p_field, abs(v))
    when 'tmax_change'       then 'high ' || healthlog_fmt_reading(p_field, abs(v)) || (case when v < 0 then ' cooler' else ' warmer' end)
  end
$$;

-- ---------- THE EVENING RUN ----------
create or replace function public.healthlog_warnings_run()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_date  date := (now() at time zone 'Asia/Tokyo')::date;
  u           record;
  r           record;
  c           record;
  v_key       text;
  v_days      jsonb;
  v_tz        text;
  v_today     date;
  v_target    date;
  t           jsonb;   -- the day the rule looks at
  p           jsonb;   -- the day before it
  v_value     numeric;
  v_prev      numeric;
  v_place     text;
  v_cands     jsonb;
  v_have      integer;
  v_users     integer := 0;
  v_checked   integer := 0;
  v_written   integer := 0;
  v_skipped   jsonb := '[]'::jsonb;
  v_lines     jsonb := '[]'::jsonb;
begin
  for u in select distinct ar.user_id from healthlog_alert_rules ar where ar.enabled loop
    v_users := v_users + 1;
    v_key := null; v_days := null;

    -- Place: 'here' while it is fresh, else 'place:home' (hub rule).
    select w.key, w.days into v_key, v_days
      from akatsuki_weather w
     where w.user_id = u.user_id
       and w.key in ('here', 'place:home')
       and jsonb_typeof(w.days) = 'array'
       and (w.key = 'place:home' or w.fetched_at > now() - interval '6 hours')
     order by (w.key = 'here') desc
     limit 1;
    if v_key is null then
      v_skipped := v_skipped || jsonb_build_object('user_id', u.user_id, 'reason', 'no here/place:home forecast');
      continue;
    end if;
    v_place := case when v_key = 'here' then 'Here' else 'Home' end;

    select d.tz into v_tz
      from akatsuki_weather_daily d
     where d.user_id = u.user_id and d.key = v_key and d.tz is not null
     order by d.date desc limit 1;
    v_today := (now() at time zone coalesce(v_tz, 'Asia/Tokyo'))::date;

    v_cands := '[]'::jsonb;
    for r in
      select ar.* from healthlog_alert_rules ar
       where ar.user_id = u.user_id and ar.enabled
         -- tied rules only while that symptom is open
         and (ar.symptom is null or exists (
               select 1 from healthlog_symptoms s
                where s.user_id = u.user_id and s.ended_on is null
                  and lower(trim(s.symptom)) = lower(trim(ar.symptom))))
    loop
      v_checked := v_checked + 1;
      if exists (select 1 from healthlog_alert_events e
                  where e.user_id = u.user_id and e.rule_id = r.id
                    and e.run_date > v_run_date - r.cooldown_days) then
        continue;
      end if;

      v_target := v_today + r.day;
      t := (select d from jsonb_array_elements(v_days) d where d->>'date' = v_target::text limit 1);
      if t is null then continue; end if;
      p := (select d from jsonb_array_elements(v_days) d where d->>'date' = (v_target - 1)::text limit 1);
      if p is null then
        select to_jsonb(h) into p from akatsuki_weather_daily h
         where h.user_id = u.user_id and h.key = v_key and h.date = v_target - 1;
      end if;

      v_value := case r.field
        when 'temp_gap'        then (t->>'tmax_c')::numeric - (t->>'tmin_c')::numeric
        when 'pressure_change' then (t->>'pressure_hpa_mean')::numeric - (p->>'pressure_hpa_mean')::numeric
        when 'tmax_change'     then (t->>'tmax_c')::numeric - (p->>'tmax_c')::numeric
        else (t->>r.field)::numeric end;
      v_prev := case r.field
        when 'temp_gap'        then (p->>'tmax_c')::numeric - (p->>'tmin_c')::numeric
        when 'pressure_change' then (p->>'pressure_hpa_mean')::numeric
        when 'tmax_change'     then (p->>'tmax_c')::numeric
        else (p->>r.field)::numeric end;
      if v_value is null then continue; end if;
      if not (case r.op when 'lt' then v_value < r.threshold else v_value > r.threshold end) then continue; end if;

      v_cands := v_cands || jsonb_build_object(
        'rule_id', r.id, 'field', r.field, 'op', r.op, 'threshold', r.threshold, 'symptom', r.symptom,
        'for_date', v_target, 'value', v_value, 'today_value', v_prev,
        'tied', r.symptom is not null, 'priority', r.priority,
        'score', abs(v_value - r.threshold) / greatest(abs(r.threshold), 1),
        'message', replace(r.message, '{value}',
                     case when r.field in ('pressure_change', 'tmax_change')
                          then trim_scale(round(abs(v_value), 1))::text
                          when r.field in ('rh_min_pct', 'rh_mean_pct') then round(v_value)::text
                          else trim_scale(round(v_value, 1))::text end),
        'line', '[' || (case r.day when 1 then 'Tomorrow' else 'Today' end) || ' · ' || v_place || '] '
                || r.name || ': ' || healthlog_warning_phrase(r.field, v_value)
                || coalesce(' (' || (case r.day when 1 then 'today ' else 'yesterday ' end)
                            || healthlog_fmt_reading(case r.field when 'temp_gap' then 'tmax_c'
                                                                  when 'tmax_change' then 'tmax_c'
                                                                  else r.field end, v_prev) || ')', '')
                || '.'
                || coalesce(' ' || upper(left(r.tip, 1)) || substr(r.tip, 2)
                            || (case when right(r.tip, 1) in ('.', '!', '?') then '' else '.' end), '')
      );
    end loop;

    -- At most 3 lines per evening: tied-to-an-open-symptom first, then priority,
    -- then how far past the threshold.
    select count(*) into v_have from healthlog_alert_events e where e.user_id = u.user_id and e.run_date = v_run_date;
    for c in
      select x.value as j, row_number() over (order by (x.value->>'tied')::boolean desc, (x.value->>'priority')::int, (x.value->>'score')::numeric desc) as n
        from jsonb_array_elements(v_cands) x
    loop
      exit when v_have + c.n > 3;
      insert into healthlog_alert_events
        (user_id, rule_id, run_date, for_date, weather_key, place_label, field, op, threshold,
         value, today_value, symptom, rank, message, line)
      values
        (u.user_id, (c.j->>'rule_id')::uuid, v_run_date, (c.j->>'for_date')::date, v_key, v_place,
         c.j->>'field', c.j->>'op', (c.j->>'threshold')::numeric,
         (c.j->>'value')::numeric, (c.j->>'today_value')::numeric, c.j->>'symptom',
         v_have + c.n, c.j->>'message', c.j->>'line')
      on conflict (rule_id, run_date) do nothing;
      if found then
        v_written := v_written + 1;
        v_lines := v_lines || jsonb_build_object('weather_key', v_key, 'line', c.j->>'line');
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'run_date', v_run_date, 'users', v_users, 'rules_checked', v_checked,
    'events_written', v_written, 'lines', v_lines, 'skipped', v_skipped);
end;
$$;

-- Only cron (postgres) runs it.
revoke execute on function public.healthlog_warnings_run() from public, anon, authenticated;
revoke execute on function public.healthlog_starter_rules() from public, anon;
revoke execute on function public.healthlog_fmt_reading(text, numeric) from public, anon;
revoke execute on function public.healthlog_warning_phrase(text, numeric) from public, anon;
grant execute on function public.healthlog_starter_rules() to authenticated;

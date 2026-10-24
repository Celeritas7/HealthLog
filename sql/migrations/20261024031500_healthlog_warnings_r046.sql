-- ============================================================
-- HealthLog — evening warnings, revised for Akatsuki R046
-- Migration name: healthlog_warnings_r046
-- Applied 2026-10-24 ~03:15 UTC from the SQL editor, so it has no row in
-- supabase_migrations.schema_migrations; this file is its record.
--
-- - General warnings now come from the hub: akatsuki_weather days[].risk
--   (same flags Calendar and Setu show) plus seasons. The starter general
--   rules are deleted; healthlog_alert_rules keeps only symptom-tied rules,
--   using the hub's field names (day fields + change.d_* deltas).
-- - "Tomorrow" reads key 'plan' (days[].at = home / office / here), falling
--   back to 'place:home'. "Today" rules keep 'here' → 'place:home'.
-- - Reads akatsuki_* only; writes healthlog_* only. Runs as postgres via
--   pg_cron (job healthlog-warnings, unchanged), so every query filters user_id.
-- ============================================================

-- ---------- RULES: symptom-tied only, hub field names ----------
-- Deleting the general starters also removes their events (FK cascade).
delete from public.healthlog_alert_rules where symptom is null or trim(symptom) = '';

alter table public.healthlog_alert_rules drop constraint if exists healthlog_alert_rules_field_check;
alter table public.healthlog_alert_rules add constraint healthlog_alert_rules_field_check check (field in (
  -- days[] fields
  'rh_min_pct','rh_mean_pct','pressure_hpa_mean','pressure_d24_hpa','tmax_c','tmin_c','feels_max_c',
  'precip_mm','precip_prob_pct','wind_max_ms','gust_max_ms','uv_max',
  -- days[].change deltas vs the day before
  'd_tmax_c','d_tmin_c','d_rh_mean_pct','d_pressure_hpa'));
alter table public.healthlog_alert_rules add constraint healthlog_alert_rules_symptom_check
  check (symptom is not null and trim(symptom) <> '');
alter table public.healthlog_alert_rules alter column symptom set not null;
alter table public.healthlog_alert_rules drop column if exists starter_key;

drop function if exists public.healthlog_add_starter_rules();
drop function if exists public.healthlog_starter_rules();

-- ---------- EVENTS: rule lines and hub risk lines ----------
alter table public.healthlog_alert_events alter column rule_id drop not null;
alter table public.healthlog_alert_events
  add column if not exists source  text not null default 'rule',
  add column if not exists risk_id text,              -- hub days[].risk[].id
  add column if not exists level   text,              -- hub level: watch | high
  add column if not exists season  text;              -- hub seasons[].label covering for_date
alter table public.healthlog_alert_events alter column source drop default;
alter table public.healthlog_alert_events add constraint healthlog_alert_events_source_check
  check ((source = 'rule' and rule_id is not null and risk_id is null)
      or (source = 'hub'  and rule_id is null     and risk_id is not null));
alter table public.healthlog_alert_events drop constraint if exists healthlog_alert_events_weather_key_check;
alter table public.healthlog_alert_events add constraint healthlog_alert_events_weather_key_check
  check (weather_key in ('plan', 'here', 'place:home'));
create unique index if not exists healthlog_alert_events_hub_once
  on public.healthlog_alert_events (user_id, run_date, risk_id) where risk_id is not null;

-- Hub lines have no rule to cascade from, so "Delete my data" removes them directly.
create policy "own healthlog_alert_events delete" on public.healthlog_alert_events
  for delete to authenticated using (auth.uid() = user_id);

-- ---------- TEXT ----------
create or replace function public.healthlog_fmt_reading(p_field text, v numeric)
returns text
language sql immutable set search_path = public
as $$
  select case
    when v is null then null
    when p_field in ('rh_min_pct', 'rh_mean_pct', 'precip_prob_pct', 'd_rh_mean_pct') then round(v)::text || '%'
    when p_field in ('pressure_hpa_mean', 'pressure_d24_hpa', 'd_pressure_hpa') then trim_scale(round(v, 1))::text || ' hPa'
    when p_field = 'precip_mm' then trim_scale(round(v, 1))::text || ' mm'
    when p_field in ('wind_max_ms', 'gust_max_ms') then trim_scale(round(v, 1))::text || ' m/s'
    when p_field = 'uv_max' then trim_scale(round(v, 1))::text
    else trim_scale(round(v, 1))::text || ' °C'
  end
$$;

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
    when 'feels_max_c'       then 'feels like up to ' || healthlog_fmt_reading(p_field, v)
    when 'precip_mm'         then 'rain ' || healthlog_fmt_reading(p_field, v)
    when 'precip_prob_pct'   then 'rain chance ' || healthlog_fmt_reading(p_field, v)
    when 'wind_max_ms'       then 'wind up to ' || healthlog_fmt_reading(p_field, v)
    when 'gust_max_ms'       then 'gusts up to ' || healthlog_fmt_reading(p_field, v)
    when 'uv_max'            then 'UV index ' || healthlog_fmt_reading(p_field, v)
    when 'pressure_d24_hpa'  then 'pressure ' || (case when v < 0 then 'falls ' else 'rises ' end) || healthlog_fmt_reading(p_field, abs(v))
    when 'd_pressure_hpa'    then 'pressure ' || (case when v < 0 then 'falls ' else 'rises ' end) || healthlog_fmt_reading(p_field, abs(v))
    when 'd_tmax_c'          then 'high ' || healthlog_fmt_reading(p_field, abs(v)) || (case when v < 0 then ' cooler' else ' warmer' end)
    when 'd_tmin_c'          then 'low ' || healthlog_fmt_reading(p_field, abs(v)) || (case when v < 0 then ' cooler' else ' warmer' end)
    when 'd_rh_mean_pct'     then 'humidity ' || (case when v < 0 then 'down ' else 'up ' end) || round(abs(v))::text || ' points'
  end
$$;

-- Health Log's practical line after each hub risk reason. No diagnosis words.
create or replace function public.healthlog_risk_tip(p_risk text)
returns text
language sql immutable set search_path = public
as $$
  select case p_risk
    when 'temp_swing'     then 'Carry a layer'
    when 'day_night'      then 'Carry a layer for the evening'
    when 'pressure_fall'  then 'Take it easy, keep water and any usual remedy handy'
    when 'dry'            then 'Warm drinks, mask outside, humidifier at night'
    when 'heat'           then 'Drink more water, lighter clothes'
    when 'muggy'          then 'Drink water, keep rooms aired'
    when 'storm'          then 'Check plans before heading out'
    when 'tropical_night' then 'Keep the bedroom cool, water by the bed'
  end
$$;

-- "Reason. Tip." with one full stop each, whatever the inputs end with.
create or replace function public.healthlog_sentence(p text)
returns text
language sql immutable set search_path = public
as $$
  select case when p is null or trim(p) = '' then null
              else upper(left(trim(p), 1)) || substr(trim(p), 2)
                   || (case when right(trim(p), 1) in ('.', '!', '?') then '' else '.' end) end
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
  v_tz        text;
  v_cands     jsonb;
  v_have      integer;
  v_users     integer := 0;
  v_checked   integer := 0;
  v_written   integer := 0;
  v_skipped   jsonb := '[]'::jsonb;
  v_lines     jsonb := '[]'::jsonb;
  -- tomorrow: plan → place:home
  tm_key      text;
  tm_days     jsonb;
  tm_seasons  jsonb;
  tm_today    date;
  tm_day      jsonb;
  tm_place    text;
  tm_season   text;
  -- today: here (fresh) → place:home
  td_key      text;
  td_days     jsonb;
  td_today    date;
  td_place    text;
  -- per rule
  v_key       text;
  v_place     text;
  v_target    date;
  t           jsonb;
  p           jsonb;
  v_value     numeric;
  v_prev      numeric;
  v_delta     boolean;
begin
  for u in
    select user_id from healthlog_visits
    union select user_id from healthlog_symptoms
    union select user_id from healthlog_food_remedies
    union select user_id from healthlog_settings
    union select user_id from healthlog_alert_rules where enabled
  loop
    v_users := v_users + 1;
    v_cands := '[]'::jsonb;

    -- ----- tomorrow's place: 'plan', else 'place:home' (R046) -----
    tm_key := null; tm_days := null; tm_seasons := null; tm_day := null; tm_season := null;
    select w.key, w.days, w.seasons into tm_key, tm_days, tm_seasons
      from akatsuki_weather w
     where w.user_id = u.user_id and w.key in ('plan', 'place:home') and jsonb_typeof(w.days) = 'array'
     order by (w.key = 'plan') desc
     limit 1;
    if tm_key is not null then
      v_tz := null;
      select d.tz into v_tz from akatsuki_weather_daily d
       where d.user_id = u.user_id and d.key = 'place:home' and d.tz is not null
       order by d.date desc limit 1;
      tm_today := (now() at time zone coalesce(v_tz, 'Asia/Tokyo'))::date;
      tm_day := (select d from jsonb_array_elements(tm_days) d where d->>'date' = (tm_today + 1)::text limit 1);
      if tm_day is null and tm_key = 'plan' then
        -- plan has no row for tomorrow: fall back to home
        select w.key, w.days, w.seasons into tm_key, tm_days, tm_seasons
          from akatsuki_weather w
         where w.user_id = u.user_id and w.key = 'place:home' and jsonb_typeof(w.days) = 'array';
        tm_day := (select d from jsonb_array_elements(tm_days) d where d->>'date' = (tm_today + 1)::text limit 1);
      end if;
      tm_place := case coalesce(tm_day->>'at', 'home')
                    when 'office' then 'Office' when 'here' then 'Here' else 'Home' end;
      select s->>'label' into tm_season
        from jsonb_array_elements(coalesce(tm_seasons, '[]'::jsonb)) s
       where (s->>'from')::date <= tm_today + 1 and (s->>'to')::date >= tm_today + 1
       limit 1;
    end if;

    -- ----- today's place: 'here' while fresh, else 'place:home' (R045) -----
    td_key := null; td_days := null;
    select w.key, w.days into td_key, td_days
      from akatsuki_weather w
     where w.user_id = u.user_id and w.key in ('here', 'place:home') and jsonb_typeof(w.days) = 'array'
       and (w.key = 'place:home' or w.fetched_at > now() - interval '6 hours')
     order by (w.key = 'here') desc
     limit 1;
    if td_key is not null then
      v_tz := null;
      select d.tz into v_tz from akatsuki_weather_daily d
       where d.user_id = u.user_id and d.key = td_key and d.tz is not null
       order by d.date desc limit 1;
      td_today := (now() at time zone coalesce(v_tz, 'Asia/Tokyo'))::date;
      td_place := case when td_key = 'here' then 'Here' else 'Home' end;
    end if;

    if tm_day is null and td_key is null then
      v_skipped := v_skipped || jsonb_build_object('user_id', u.user_id, 'reason', 'no plan/place:home/here forecast');
      continue;
    end if;

    -- ----- symptom-tied rules (only while the symptom is open) -----
    for r in
      select ar.* from healthlog_alert_rules ar
       where ar.user_id = u.user_id and ar.enabled
         and exists (select 1 from healthlog_symptoms s
                      where s.user_id = u.user_id and s.ended_on is null
                        and lower(trim(s.symptom)) = lower(trim(ar.symptom)))
    loop
      v_checked := v_checked + 1;
      if exists (select 1 from healthlog_alert_events e
                  where e.user_id = u.user_id and e.rule_id = r.id
                    and e.run_date > v_run_date - r.cooldown_days) then
        continue;
      end if;

      if r.day = 1 then
        if tm_day is null then continue; end if;
        v_key := tm_key; v_place := tm_place; v_target := tm_today + 1; t := tm_day;
        -- the same place's own forecast for today, for "(today …)"
        select (select d from jsonb_array_elements(w.days) d where d->>'date' = tm_today::text limit 1) into p
          from akatsuki_weather w
         where w.user_id = u.user_id
           and w.key = case coalesce(tm_day->>'at', 'home') when 'office' then 'place:office' when 'here' then 'here' else 'place:home' end;
      else
        if td_key is null then continue; end if;
        v_key := td_key; v_place := td_place; v_target := td_today;
        t := (select d from jsonb_array_elements(td_days) d where d->>'date' = td_today::text limit 1);
        select to_jsonb(h) into p from akatsuki_weather_daily h
         where h.user_id = u.user_id and h.key = td_key and h.date = td_today - 1;
      end if;
      if t is null then continue; end if;

      v_delta := r.field like 'd\_%' or r.field = 'pressure_d24_hpa';
      v_value := case when r.field like 'd\_%' then (t->'change'->>r.field)::numeric else (t->>r.field)::numeric end;
      v_prev  := case when v_delta then null else (p->>r.field)::numeric end;
      if v_value is null then continue; end if;
      if not (case r.op when 'lt' then v_value < r.threshold else v_value > r.threshold end) then continue; end if;

      v_cands := v_cands || jsonb_build_object(
        'source', 'rule', 'rule_id', r.id, 'risk_id', null, 'level', null,
        'weather_key', v_key, 'place_label', v_place,
        'field', r.field, 'op', r.op, 'threshold', r.threshold, 'symptom', r.symptom,
        'for_date', v_target, 'value', v_value, 'today_value', v_prev,
        'grp', 0, 'ord', r.priority,
        'score', abs(v_value - r.threshold) / greatest(abs(r.threshold), 1),
        'message', replace(r.message, '{value}',
                     case when v_delta then trim_scale(round(abs(v_value), 1))::text
                          when r.field in ('rh_min_pct', 'rh_mean_pct', 'precip_prob_pct') then round(v_value)::text
                          else trim_scale(round(v_value, 1))::text end),
        'line', '[' || (case r.day when 1 then 'Tomorrow' else 'Today' end) || ' · ' || v_place || '] '
                || r.name || ': ' || healthlog_warning_phrase(r.field, v_value)
                || coalesce(' (' || (case r.day when 1 then 'today ' else 'yesterday ' end)
                            || healthlog_fmt_reading(r.field, v_prev) || ')', '')
                || '.' || coalesce(' ' || healthlog_sentence(r.tip), '')
      );
    end loop;

    -- ----- hub risk flags for tomorrow -----
    if tm_day is not null then
      for c in
        select x.value as j, x.ordinality as n
          from jsonb_array_elements(coalesce(tm_day->'risk', '[]'::jsonb)) with ordinality x
         where x.value->>'id' is not null
      loop
        v_cands := v_cands || jsonb_build_object(
          'source', 'hub', 'rule_id', null, 'risk_id', c.j->>'id', 'level', c.j->>'level',
          'weather_key', tm_key, 'place_label', tm_place,
          'field', 'risk', 'op', 'flag', 'threshold', 0, 'symptom', null,
          'for_date', tm_today + 1, 'value', 0, 'today_value', null,
          'grp', case when c.j->>'level' = 'high' then 1 else 2 end, 'ord', c.n, 'score', 0,
          'message', coalesce(c.j->>'reason', c.j->>'id'),
          'line', '[Tomorrow · ' || tm_place || '] '
                  || coalesce(healthlog_sentence(c.j->>'reason'), healthlog_sentence(c.j->>'id'))
                  || coalesce(' ' || healthlog_sentence(healthlog_risk_tip(c.j->>'id')), '')
        );
      end loop;
    end if;

    -- ----- at most 3 lines: tied rules, then high flags, then watch flags -----
    select count(*) into v_have from healthlog_alert_events e where e.user_id = u.user_id and e.run_date = v_run_date;
    for c in
      select x.value as j,
             row_number() over (order by (x.value->>'grp')::int, (x.value->>'ord')::int, (x.value->>'score')::numeric desc) as n
        from jsonb_array_elements(v_cands) x
       -- skip what this evening already holds, so a rerun fills free slots only
       where not exists (select 1 from healthlog_alert_events e
                          where e.user_id = u.user_id and e.run_date = v_run_date
                            and (e.rule_id = (x.value->>'rule_id')::uuid or e.risk_id = x.value->>'risk_id'))
    loop
      exit when v_have + c.n > 3;
      insert into healthlog_alert_events
        (user_id, rule_id, source, risk_id, level, season, run_date, for_date, weather_key, place_label,
         field, op, threshold, value, today_value, symptom, rank, message, line)
      values
        (u.user_id, (c.j->>'rule_id')::uuid, c.j->>'source', c.j->>'risk_id', c.j->>'level',
         case when (c.j->>'for_date')::date = tm_today + 1 then tm_season end,
         v_run_date, (c.j->>'for_date')::date, c.j->>'weather_key', c.j->>'place_label',
         c.j->>'field', c.j->>'op', (c.j->>'threshold')::numeric,
         (c.j->>'value')::numeric, (c.j->>'today_value')::numeric, c.j->>'symptom',
         v_have + c.n, c.j->>'message', c.j->>'line');
      v_written := v_written + 1;
      v_lines := v_lines || jsonb_build_object('weather_key', c.j->>'weather_key', 'line', c.j->>'line');
    end loop;
  end loop;

  return jsonb_build_object(
    'run_date', v_run_date, 'users', v_users, 'rules_checked', v_checked,
    'events_written', v_written, 'lines', v_lines, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.healthlog_warnings_run() from public, anon, authenticated;
revoke execute on function public.healthlog_fmt_reading(text, numeric) from public, anon;
revoke execute on function public.healthlog_warning_phrase(text, numeric) from public, anon;
revoke execute on function public.healthlog_risk_tip(text) from public, anon;
revoke execute on function public.healthlog_sentence(text) from public, anon;

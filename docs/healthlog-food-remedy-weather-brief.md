# Health Log brief v1 — food remedies, "Did it help?", weather warnings

From Aniket, via Akatsuki. Confirmed 2026-10-24 (see "Confirmed decisions" below).

> **Revised by Akatsuki R046 (2026-10-24)** — general warnings now come from the hub, and
> "tomorrow" reads key `plan`. Where §1–2 and R046 differ, R046 wins; see the
> "R046 changes" section at the end.

## 1. Alert rules (table `healthlog_alert_rules`)

Columns:

- `id`, `user_id`, `name`, `enabled`
- `field`: one of `rh_min_pct`, `rh_mean_pct`, `pressure_hpa_mean`, `tmax_c`, `tmin_c`,
  `precip_mm`, `wind_max_ms`, plus three derived fields:
  - `temp_gap` = `tmax_c` − `tmin_c` (same day)
  - `pressure_change` = tomorrow's `pressure_hpa_mean` − today's
  - `tmax_change` = tomorrow's `tmax_c` − today's
- `op`: `lt` | `gt` (for change fields: `gt` means a rise, `lt` means a drop)
- `threshold` (number, in the field's unit)
- `day`: 1 = tomorrow (default); 0 = today
- `symptom`: null = general rule; text = tied to that symptom
- `message`: short template, e.g. "Dry air tomorrow ({value}%)"
- `tip`: one practical line
- `cooldown_days` (default 1)

Place: `here`, falling back to `place:home`, as the hub rule says. Show which one was used.

Starter rules (general, `symptom` = null):

- Dry air: `rh_min_pct lt 35` → "Dry air tomorrow (min humidity {value}%)"
  — tip: warm drinks, mask outside, humidifier at night
- Pressure drop: `pressure_change lt -6` → "Pressure falls {value} hPa tomorrow"
- Day–night gap: `temp_gap gt 12` → "Big day–night swing tomorrow ({value} °C)"
  — tip: carry a layer
- Sudden heat: `tmax_change gt 6` → "Much warmer tomorrow (+{value} °C)"

Tied rules: while a symptom is open (`healthlog_symptoms.ended_on` is null), rules tied to
it are shown first, and general rules matching it are also shown. Later, the correlation
(symptom start date vs the 3 days before, from `akatsuki_weather_daily`) suggests new tied
rules; I approve each one by hand.

## 2. Warning text

One notice per evening, at most 3 lines, highest priority first:

> [Tomorrow · Home] Dry air: min humidity 32% (today 58%). Warm drinks, mask outside.

If a symptom is open, add one comfort-food line from Setu (once its RPC is live):
"Nearby: <name>, <distance> — <dish>".

No diagnosis words. Never "you will get sick".

## 3. "Did it help?"

- Fires once per food remedy logged (`healthlog_food_remedies`).
- Asked 4 h after `taken_at`. If that falls after 22:00, ask at 09:00 the next morning.
- Answers: helped / a bit / no / skip → fills `effect`; optional `relief_hours`.
- Not asked again after it's answered or skipped.

## 4. Inbox (in Health Log)

One in-app list of things waiting for me: today's warnings and open "Did it help?" asks.
Each item can be dismissed (`healthlog_dismissals`). Push sends the same items once the
shared hub push service exists.

## 5. Places

Part 1 reads `akatsuki_places` only to get Home's lat/lng (id `home`) for the Setu call.
That's covered by the registered places route; report it together with the first real
read, not as a separate step.

---

## Confirmed decisions (2026-10-24)

- **Answers → `effect`** (the column allows only `none` / `some` / `good`):
  helped → `good`, a bit → `some`, no → `none`. Skip leaves `effect` empty and writes a
  `healthlog_dismissals` row with key `remedy-help:<local_id>`.
- **Ask time**: from `taken_at`; else `time_of_day` (morning 08:00, noon 13:00,
  evening 18:00, before bed / night 22:00); else when the remedy was logged. Plus 4 h.
  After 22:00 → 09:00 next morning; before 09:00 → 09:00 that morning.
- **Missing tips**: Pressure drop — "Take it easy, keep water and any usual remedy handy".
  Sudden heat — "Drink more water, lighter clothes".
- **`{value}` for change fields** is shown as a size ("falls 7 hPa", "+7 °C").
- **Starter rules**: seeded for every existing Health Log user; the app adds them for a
  user who has no rules at all. *(Superseded by R046: removed.)*
- **`day = 0` change fields**: today minus yesterday.
- **Warning lifetime**: shown in the inbox until the next 18:00 run.
- **Priority**: rules tied to an open symptom first, then a `priority` column (starters
  1–4 in the order above), then how far past the threshold. *(R046: tied rules, then hub
  `high`, then hub `watch`.)*
- **Setu line and `akatsuki_places`**: deferred together until the hub says the Setu
  near-a-place RPC is live. Part 1 does not read `akatsuki_places`.
- **Correlation-suggested rules**: later, not v1.

## Hub notes (Akatsuki R045)

- pg_cron jobs run as `postgres` and bypass RLS — the job's SQL filters `user_id` itself.
- v1 needs no network: a plain SQL function `healthlog_warnings_run()` scheduled by pg_cron
  as `healthlog-warnings`, `0 9 * * *` (09:00 UTC = 18:00 JST). `security definer`,
  `set search_path = public`, execute revoked from anon and authenticated.
- Reads `akatsuki_weather` (`here` → fallback `place:home`) and `akatsuki_weather_daily`.
  Never writes `akatsuki_*`. Everything is named `healthlog_*`.
- An Edge Function comes only with push, and will call the shared hub push service.
- No direct reads of `setu_*` or `food_department_*`, no Chatak push tables, no Setu
  near-a-place RPC until the hub says it's live.
- After applying: report the migration name, the cron job name and schedule, and the
  result of one run. The hub then flips `weather.now` and `weather.history` to live.

## R046 changes (Akatsuki → Health Log, 2026-10-24)

From the hub:

- General weather warnings now come from the hub: `days[].risk` and `seasons` in
  `akatsuki_weather`, the same flags Calendar and Setu show. Drop the starter general rules
  from the alert table. Keep only rules tied to a symptom, using the same field names.
- For "tomorrow", read key `plan` (office on weekdays, home on weekends); fall back to
  `place:home` if `plan` is missing.
- `place:office` now has its own forecast and history (from 2026-10-01).

As built (migration `healthlog_warnings_r046`, applied 2026-10-24 from the SQL editor, so not
in Supabase's migration history):

- The four starter rules (and the events they had written) are deleted;
  `healthlog_starter_rules()` / `healthlog_add_starter_rules()` are dropped.
  `healthlog_alert_rules.symptom` is now required.
- Rule `field` uses the hub's names: day fields (`rh_min_pct`, `rh_mean_pct`,
  `pressure_hpa_mean`, `pressure_d24_hpa`, `tmax_c`, `tmin_c`, `feels_max_c`, `precip_mm`,
  `precip_prob_pct`, `wind_max_ms`, `gust_max_ms`, `uv_max`) and `change` deltas
  (`d_tmax_c`, `d_tmin_c`, `d_rh_mean_pct`, `d_pressure_hpa`). `temp_gap`,
  `pressure_change` and `tmax_change` are gone.
- Tomorrow: `plan`'s `days[].at` picks the label (`Home` / `Office` / `Here`); if `plan`
  is missing or has no row for tomorrow, `place:home`. Today rules still use `here` while
  fresh, else `place:home`. "(today …)" comes from that same place's own forecast.
- Hub lines: `[Tomorrow · Office] <hub reason>. <Health Log tip>.` Tips per risk id:
  temp_swing "Carry a layer"; day_night "Carry a layer for the evening"; pressure_fall
  "Take it easy, keep water and any usual remedy handy"; dry "Warm drinks, mask outside,
  humidifier at night"; heat "Drink more water, lighter clothes"; muggy "Drink water,
  keep rooms aired"; storm "Check plans before heading out"; tropical_night "Keep the
  bedroom cool, water by the bed". Unknown ids show the reason only.
- Both levels (`watch`, `high`) are used. Order: symptom-tied rules, then `high` flags,
  then `watch` flags (hub order within each). Still at most 3 lines per evening.
- The season covering tomorrow is the note's subtitle in the inbox
  ("Season: 秋の寒暖差 · ragweed · dry air begins"); it does not take a line.
- `healthlog_alert_events` gains `source` (`rule` | `hub`), `risk_id`, `level`, `season`;
  `rule_id` is null for hub lines; one hub line per risk per evening. Signed-in users may
  delete their own events (for "Delete my data").

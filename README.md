# HealthLog — personal medical history tracker

Track clinic visits (clinic, doctor, health concern, notes), prescribed medicines with a
daily dose schedule (morning / noon / evening / night), follow-up dates, and expenses
(consultation, medicines, tests) with monthly and per-clinic breakdowns.

## Files

| File | What it is |
|---|---|
| `index.html` | Entry point — routes phones to mobile, others to desktop |
| `HealthLog Desktop v2.dc.html` | Desktop / web app |
| `HealthLog Mobile v2.dc.html` | Mobile app |
| `healthlog-data.js` | Shared data model, schedule logic, themes, localStorage persistence |
| `healthlog-remedies.js` | Symptom log, food remedies, "Did it help?" asks, inbox and merged timeline (shared by both pages) |
| `support.js` | Runtime the app pages depend on |
| `supabase/healthlog_schema.sql` | Supabase tables, RLS, and views (all prefixed `healthlog_`) |

## Launch on GitHub Pages

1. Push this folder to a GitHub repository (repo root).
2. Repo → Settings → Pages → Source: **Deploy from a branch** → `main` / root.
3. Open `https://<user>.github.io/<repo>/` — `index.html` picks desktop or mobile.

The prototype persists to the browser's localStorage out of the box (key `healthlog-v1`),
so it works with no backend.

## Set up Supabase

1. Create a project at supabase.com.
2. SQL editor → New query → paste all of `supabase/healthlog_schema.sql` → Run.

Tables created:

- `healthlog_clinics` — clinic directory (name, phone, address)
- `healthlog_visits` — one row per visit: clinic, doctor, date, concern, notes, follow-up, costs
- `healthlog_medicines` — prescriptions per visit: name, dose, slots[], course length in days
- `healthlog_dose_logs` — taken/skipped per medicine + date + slot

Views: `healthlog_visit_totals`, `healthlog_monthly_spend`, `healthlog_active_courses`.

RLS is enabled with open demo policies (anon key can read/write). For real accounts,
switch `user_id` to `auth.uid()` as noted in the SQL comments.

### Wiring the app to Supabase

`healthlog-data.js` isolates all persistence in `loadData()` / `saveData()` — replace those
two functions with supabase-js calls against the tables above; the field names map 1:1
(visit → `healthlog_visits`, `visit.meds[]` → `healthlog_medicines`, the taken-checkmarks
map → `healthlog_dose_logs`).

## Symptoms, food remedies and the inbox

The **Log** tab (both apps) records symptoms (`healthlog_symptoms`) and food remedies
(`healthlog_food_remedies`), and shows them on one timeline with clinic visits.

- **Did it help?** — asked once per remedy, 4 h after it was taken (from `taken_at`,
  else `time_of_day`, else when it was logged). If that lands after 22:00 or before
  09:00 it is asked at 09:00. Helped / A bit / No fill `effect` (`good` / `some` /
  `none`) plus optional `relief_hours`; Skip writes a `healthlog_dismissals` row
  (`remedy-help:<local_id>`) so it is never asked again.
- **Inbox** — open "Did it help?" asks (and, from Part 2, the evening weather notes).
  A count shows on the Log tab and as a banner on Home.

Rows sync on `(user_id, local_id)` like visits; the device cache is `healthlog-log-v1`.

### Evening weather warnings

`sql/migrations/20261024_healthlog_weather_warnings.sql` adds `healthlog_alert_rules`,
`healthlog_alert_events` and `healthlog_warnings_run()`; `…_healthlog_warnings_cron.sql`
schedules it as pg_cron job `healthlog-warnings` at 09:00 UTC (18:00 JST).

- Forecast from `akatsuki_weather` (key `here` while fresh, else `place:home`), history
  from `akatsuki_weather_daily` — read only. Writes `healthlog_*` only.
- Rules compare one field (or `temp_gap` / `pressure_change` / `tmax_change`) against a
  threshold for tomorrow (or today). Rules tied to a symptom only fire while it is open
  and are listed first; then `priority`. At most 3 lines per evening, e.g.
  `[Tomorrow · Home] Dry air: min humidity 32% (today 58%). Warm drinks, mask outside.`
- Four starter rules per user; the app calls `healthlog_add_starter_rules()` after
  sign-in, which adds them only if the user has no rules.
- The note shows in the app's inbox until the next run; no push yet.
See `docs/healthlog-food-remedy-weather-brief.md` for the full brief.

## Themes

Both apps ship 5 switchable themes (Clinical Light, Warm Cream, Lavender Mist, Ocean Teal,
Midnight) plus currency (USD / INR / EUR) and monthly budget — see the `theme`,
`currency`, and `monthlyBudget` props in each `.dc.html`.

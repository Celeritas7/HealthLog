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
| `sql/healthlog_schema.sql` | Original Supabase tables, RLS, and views (all prefixed `healthlog_`) |
| `sql/migrations/` | Later migrations, timestamped to match the project's migration history: symptoms + food remedies + dismissals, weather warnings, cron job, R046 |

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

pg_cron job `healthlog-warnings` runs `healthlog_warnings_run()` at 09:00 UTC (18:00 JST).
Migrations in `sql/migrations/` (run in filename order to rebuild): `…015953_healthlog_weather_warnings.sql`,
`…020551_healthlog_warnings_cron.sql`, then `…031500_healthlog_warnings_r046.sql` (Akatsuki R046), all applied. R046 was run from the SQL editor,
so it is not listed in Supabase's migration history.

- Tomorrow's place comes from `akatsuki_weather` key `plan` (`days[].at`: home / office),
  else `place:home`. Today's from `here` while fresh, else `place:home`. Read only;
  writes `healthlog_*` only.
- General lines are the hub's `days[].risk` flags (same as Calendar and Setu) with a
  Health Log tip; `healthlog_alert_rules` holds only symptom-tied rules, using the hub's
  field names, which fire while that symptom is open and are listed first.
- At most 3 lines per evening, e.g.
  `[Tomorrow · Home] Temperature +7.5 °C vs the day before. Carry a layer.`
  The hub season is shown as the note's subtitle. In-app inbox only; no push yet.
- While a symptom is open, the app adds a Setu **Nearby** line under the note
  (`setu_comfort_spots_near`, Home from `akatsuki_places`); "Log it as a remedy" stores
  `setu_spot_id`. Remedies with an `fd_dish_id` show the dish's ingredients from
  `akatsuki_food_dish_ingredients`.

## Themes

Both apps ship 5 switchable themes (Clinical Light, Warm Cream, Lavender Mist, Ocean Teal,
Midnight) plus currency (USD / INR / EUR) and monthly budget — see the `theme`,
`currency`, and `monthlyBudget` props in each `.dc.html`.

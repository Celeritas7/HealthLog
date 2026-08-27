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

## Themes

Both apps ship 5 switchable themes (Clinical Light, Warm Cream, Lavender Mist, Ocean Teal,
Midnight) plus currency (USD / INR / EUR) and monthly budget — see the `theme`,
`currency`, and `monthlyBudget` props in each `.dc.html`.

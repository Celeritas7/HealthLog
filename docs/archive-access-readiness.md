# Commonplace G0 — HealthLog archive compatibility

2026-11-26. Source reviewed at
`87aa0920b26b4c200c6b160516bb2f80abb126df`. This change adds documentation,
synthetic tests and a CI workflow only. It does not deploy or alter HealthLog.

The Commonplace shared-backend work prepares read-only, verified-owner access
to the old HealthLog archive. See the
[Commonplace candidate and acceptance evidence](https://github.com/Celeritas7/Commonplace/blob/fix/g0-healthlog-archive/platform/acceptance/HEALTHLOG-ARCHIVE-READINESS.md).

## Inspected consumers

| Source | Data contract |
| --- | --- |
| `index.html` | Routes to the current mobile or desktop page |
| Both root `HealthLog ... v2.dc.html` pages | Import `healthlog-sync.js`; call `syncNow` |
| `healthlog-sync.js` | Authenticated UUID reads/writes to current visits, medicines, dose logs, conflicts and settings |
| `healthlog-remedies.js` | Current symptoms, food remedies, dismissals and alert events; separate connected-app lookups |
| `healthlog-data.js` and both `Temp/` prototypes | Local saved data and sample data |
| `support.js` | Runtime and source loading; no HealthLog archive endpoint |
| `sql/healthlog_schema.sql` | Historical prototype schema with text keys and demo policies; not a current production bootstrap |

No inspected runtime source names `healthlog_clinics_old`, `healthlog_visits_old`,
`healthlog_medicines_old` or `healthlog_dose_logs_old`. Therefore the proposed
archive policy change needs no change to these current clients. This source
review cannot rule out old downloaded pages, separate scripts or external jobs.
Those require operator confirmation before enforcement. If an archive writer
is found, stop and review its authenticated contract before making archives
read-only. Do not repoint the current app to the archives or automatically merge
archive history into current tables.

## Tests

Run `node --test tests/*.test.mjs`. No package installation is required.

The suite reads the current desktop/mobile/prototype/shared sources and executes
the actual sync module with an injected fake Supabase transport. All fixture
records and UUIDs are synthetic, and fetch calls fail during the sync tests.
It checks the current pull/repeated-sync and settings contracts, notes,
medicines, costs, a taken dose, preservation of the other account's server
fixture and unrelated saved-data keys. These are client compatibility tests,
not proof of server authorization. Commonplace's companion suite runs actual
candidate SQL and real JWT tests on a disposable local Supabase stack.

## Release limits

No actual ownership mappings or live cutover attestation are supplied. The
Commonplace candidate requires verified original-key mappings and rejects
unreviewed schema/policy/helper drift or conflicting ownership relationships.
Archive row IDs, text owner keys and data remain unchanged. A Commonplace
administrator has no implicit access to someone's medical archive.

Current HealthLog device caches are still shared keys (`healthlog-v1`,
`healthlog-sync-meta`, `healthlog-log-v1`), and sign-in can merge device work.
These tests use isolated client fixtures; they do not certify safe account
switching or multi-user offline use. That existing client behavior needs its
own review before sharing devices. Current-table relationship/grant checks,
weather routines and connected-app paths are outside this archive change.

No Auth/provider settings, database data or permissions, local saved work,
icons, app entry points or existing downloads are changed. Recovery work stays
deferred at the Commonplace checkpoint; live rollout and learner enrollment
remain on hold. Merging this PR only adds review evidence and CI.

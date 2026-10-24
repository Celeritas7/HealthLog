-- ============================================================
-- HealthLog — schedule the evening weather warnings
-- Migration name: healthlog_warnings_cron
--
-- 18:00 JST = 09:00 UTC. Plain SQL, no network, runs as postgres.
-- cron.schedule() with an existing name updates that job in place.
-- ============================================================
select cron.schedule('healthlog-warnings', '0 9 * * *', $$select public.healthlog_warnings_run();$$);

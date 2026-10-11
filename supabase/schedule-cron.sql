-- Schedules the daily-schedule-email Edge Function to run every morning.
-- Run this in the Supabase SQL editor AFTER deploying the edge function.
-- Replace the two placeholders below with your project's values
-- (Project Settings -> API: Project URL, and the service_role secret key).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daily-schedule-email',
  '0 7 * * *',  -- 07:00 UTC; Supabase cron runs in UTC, Israel is UTC+2/+3 - adjust below if needed
  $$
  select net.http_post(
    url := 'https://REPLACE_PROJECT_REF.supabase.co/functions/v1/daily-schedule-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer REPLACE_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Note on timezone: Supabase cron runs in UTC. Israel is UTC+2 (winter) / UTC+3 (summer, DST).
-- '0 7 * * *' UTC = 09:00/10:00 Israel time. To land close to 07:00 Israel time year-round,
-- use '0 4 * * *' (07:00 in winter, 06:00 in summer) or run two schedules with a month-based
-- cutover. Simplest fix for a single-admin project: just pick the UTC hour that lands where
-- you want and revisit twice a year, or schedule '30 4 * * *' as a reasonable year-round compromise.

-- To check / unschedule later:
--   select * from cron.job;
--   select cron.unschedule('daily-schedule-email');

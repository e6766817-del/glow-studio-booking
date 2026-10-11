-- Schedules the daily-schedule-email Edge Function to run every morning.
-- Run this in the Supabase SQL editor (as the postgres/service role user).
--
-- The service_role key is never written into this file or into cron.job's
-- stored SQL in plain text: it's stashed once in Supabase Vault (encrypted
-- at rest) and the cron job reads it back at run time via vault.decrypted_secrets.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Step 1 - run ONCE, with your real service_role key (Project Settings > API).
-- Do this directly in the SQL editor; never commit this statement with a real key.
-- select vault.create_secret('<your service_role key>', 'daily_email_service_key');

-- Step 2 - schedule the job. Safe to keep in version control: it contains no secret,
-- only a reference to the Vault entry created above.
select cron.schedule(
  'daily-schedule-email',
  '0 4 * * *',  -- 04:00 UTC = 07:00 Israel time in summer (DST) / 06:00 in winter
  $$
  select net.http_post(
    url := 'https://hmnufsmusrgadbetpsaq.supabase.co/functions/v1/daily-schedule-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'daily_email_service_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check / unschedule later:
--   select * from cron.job;
--   select cron.unschedule('daily-schedule-email');
-- To rotate the stored key later:
--   select vault.update_secret((select id from vault.secrets where name='daily_email_service_key'), '<new key>');

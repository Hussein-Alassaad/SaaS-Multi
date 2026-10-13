-- Runs the agency "clock" every minute from inside Supabase: meeting reminders (1 hour before a call) and the
-- "a customer is waiting for an answer" alert. Nothing else needs to run for them.
--
-- BEFORE RUNNING: replace the two placeholders below
--   <APP_URL>      your live site address, e.g. https://nexaris.example.com   (no trailing slash)
--   <CRON_SECRET>  the same value as the CRON_SECRET environment variable on Vercel
-- Then paste the whole file into Supabase > SQL Editor and run it once. Safe to run again (it replaces the job).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'agency-tick';

select cron.schedule(
  'agency-tick',
  '* * * * *',
  $$select net.http_get(
      url := '<APP_URL>/api/cron/agency-tick',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
      timeout_milliseconds := 30000
  )$$
);

-- To check it is running:   select * from cron.job_run_details order by start_time desc limit 5;
-- To stop it:               select cron.unschedule('agency-tick');

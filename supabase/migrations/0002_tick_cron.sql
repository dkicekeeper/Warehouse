-- The minute tick: Postgres itself calls the service once a minute.
-- (Vercel's own cron cannot run more often than daily on the free plan.)
--
-- Before applying, store the two values in Vault — they must not appear in this file:
--   select vault.create_secret('https://<production host>/api/cron/tick', 'warehouse_tick_url');
--   select vault.create_secret('<CRON_TOKEN>', 'warehouse_cron_token');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'warehouse-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'warehouse_tick_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'warehouse_cron_token')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

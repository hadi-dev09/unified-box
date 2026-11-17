-- Every minute, Supabase calls /api/cron/sync. The key is generated inside the database (Vault) and never leaves it;
-- the app only stores its SHA-256 in internal_config. (Applied with the project URL filled in.)
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
declare k text;
begin
  if not exists (select 1 from vault.secrets where name = 'ub_cron_key') then
    k := encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(k, 'ub_cron_key', 'Unified Box background sync key');
    insert into public.internal_config(name, value) values ('cron_key_sha256', encode(extensions.digest(k, 'sha256'), 'hex'))
      on conflict (name) do update set value = excluded.value, updated_at = now();
  end if;
end $$;
select cron.schedule('unified-box-sync', '* * * * *', $job$
  select net.http_post(
    url := 'https://unified-box-eight.vercel.app/api/cron/sync',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'ub_cron_key')),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
$job$);

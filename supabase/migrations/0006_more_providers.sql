-- Allow the new connectors (Outlook, WhatsApp, Telegram already allowed; plus future ones) and per-account metadata.
alter table public.accounts drop constraint if exists accounts_provider_check;
alter table public.accounts add constraint accounts_provider_check
  check (provider in ('gmail','outlook','slack','whatsapp','telegram','teams','sms','instagram','messenger','upwork','discord','google_chat'));
alter table public.accounts add column if not exists meta jsonb not null default '{}';

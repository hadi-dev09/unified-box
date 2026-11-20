-- Accounts connected through Unipile keep Unipile's account id; LinkedIn messages become connectable.
alter table public.accounts add column if not exists remote_id text;
create index if not exists accounts_remote_id_idx on public.accounts (remote_id) where remote_id is not null;
alter table public.accounts drop constraint if exists accounts_provider_check;
alter table public.accounts add constraint accounts_provider_check
  check (provider in ('gmail','outlook','slack','whatsapp','whatsapp_web','imap','telegram','teams','sms','instagram','messenger','upwork','discord','google_chat','linkedin'));

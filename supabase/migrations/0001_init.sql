-- Unified Box: initial schema. All tables are owner-scoped via RLS.
create extension if not exists pgcrypto;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail','slack','whatsapp','telegram','upwork')),
  account_type text not null default 'personal' check (account_type in ('personal','company')),
  display_name text not null,
  external_id text not null,                  -- e.g. email address
  status text not null default 'connected'
    check (status in ('connected','needs_reauth','blocked_by_admin','error')),
  status_detail text,
  can_send boolean not null default false,    -- true only if a send scope was granted
  last_synced_at timestamptz,
  sync_cursor text,
  created_at timestamptz not null default now(),
  unique (user_id, provider, external_id)
);

-- Tokens live apart from accounts and have NO policies: only the service role can read them.
create table public.account_secrets (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  tokens_enc text not null
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  external_id text not null,
  subject text,
  snippet text,
  last_message_at timestamptz not null default now(),
  unread boolean not null default false,
  needs_reply boolean not null default false,
  unique (account_id, external_id)
);
create index threads_user_recent on public.threads (user_id, last_message_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  thread_id uuid not null references public.threads(id) on delete cascade,
  external_id text not null,
  from_addr text,
  from_name text,
  to_addrs text[] not null default '{}',
  subject text,
  body_text text,
  sent_at timestamptz not null,
  is_outgoing boolean not null default false,
  unique (account_id, external_id)
);
create index messages_thread on public.messages (thread_id, sent_at);

-- Anything that sends goes through here. Nothing is sent unless status moves to 'approved' by the user.
create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  thread_id uuid references public.threads(id) on delete set null,
  to_addrs text[] not null,
  subject text not null,
  body text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','sent','rejected','failed')),
  created_by text not null check (created_by in ('claude','user')),
  error text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor text not null,            -- 'user' | 'claude' | 'system'
  action text not null,
  target text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
alter table public.account_secrets enable row level security;
alter table public.clients enable row level security;
alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.drafts enable row level security;
alter table public.audit_log enable row level security;

create policy own_accounts on public.accounts for select using (user_id = auth.uid());
create policy own_clients on public.clients for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_threads on public.threads for select using (user_id = auth.uid());
create policy own_messages on public.messages for select using (user_id = auth.uid());
create policy own_drafts on public.drafts for select using (user_id = auth.uid());
create policy own_audit on public.audit_log for select using (user_id = auth.uid());
-- account_secrets: intentionally no policy. Drafts/threads are written only by server code (service role).

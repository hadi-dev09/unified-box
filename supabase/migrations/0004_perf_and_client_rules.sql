-- Performance: evaluate auth.uid() once per query, not per row.
drop policy if exists own_accounts on public.accounts;
drop policy if exists own_clients on public.clients;
drop policy if exists own_threads on public.threads;
drop policy if exists own_messages on public.messages;
drop policy if exists own_drafts on public.drafts;
drop policy if exists own_audit on public.audit_log;
create policy own_accounts on public.accounts for select using (user_id = (select auth.uid()));
create policy own_clients on public.clients for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_threads on public.threads for select using (user_id = (select auth.uid()));
create policy own_messages on public.messages for select using (user_id = (select auth.uid()));
create policy own_drafts on public.drafts for select using (user_id = (select auth.uid()));
create policy own_audit on public.audit_log for select using (user_id = (select auth.uid()));

-- Performance: cover foreign keys.
create index if not exists audit_log_user_idx on public.audit_log (user_id, created_at desc);
create index if not exists drafts_account_idx on public.drafts (account_id);
create index if not exists drafts_thread_idx on public.drafts (thread_id);
create index if not exists drafts_user_status_idx on public.drafts (user_id, status);
create index if not exists messages_user_idx on public.messages (user_id);
create index if not exists oauth_codes_client_idx on public.oauth_codes (client_id);
create index if not exists oauth_codes_user_idx on public.oauth_codes (user_id);
create index if not exists oauth_tokens_client_idx on public.oauth_tokens (client_id);
create index if not exists threads_client_idx on public.threads (client_id);
create index if not exists threads_account_idx on public.threads (account_id);

-- Client auto-grouping: map a sender email or domain to a client.
create table if not exists public.client_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('email','domain')),
  pattern text not null,                       -- lowercase email or domain, no '@'
  created_at timestamptz not null default now(),
  unique (user_id, kind, pattern)
);
create index if not exists client_rules_user_idx on public.client_rules (user_id);
create index if not exists client_rules_client_idx on public.client_rules (client_id);
alter table public.client_rules enable row level security;
create policy own_client_rules on public.client_rules for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

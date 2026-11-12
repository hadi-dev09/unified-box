-- Additive only (no drops).
-- Read state kept in Unified Box, so opening a thread marks it read even with read-only Gmail access.
alter table public.threads add column if not exists seen_at timestamptz;
-- Reply-all and proper threading in recipients' mail apps.
alter table public.messages add column if not exists cc_addrs text[] not null default '{}';
alter table public.messages add column if not exists rfc_message_id text;
alter table public.drafts add column if not exists cc_addrs text[] not null default '{}';
alter table public.drafts add column if not exists mode text not null default 'reply' check (mode in ('reply','reply_all','forward','new'));

-- Personal access keys for AI tools that can't do the OAuth sign-in screen (Cursor, Grok API, scripts).
create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_tokens_user_idx on public.api_tokens (user_id);
alter table public.api_tokens enable row level security; -- no policies: server-only

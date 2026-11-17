-- Nicknames for connected accounts, per-thread actions, and a server-side key for the background sync job.
alter table public.accounts add column if not exists label text check (label is null or char_length(label) between 1 and 60);
alter table public.threads add column if not exists starred boolean not null default false;
alter table public.threads add column if not exists snoozed_until timestamptz;
alter table public.threads add column if not exists trashed_at timestamptz;
create index if not exists threads_user_visible on public.threads (user_id, last_message_at desc) where trashed_at is null;
create index if not exists threads_snoozed on public.threads (snoozed_until) where snoozed_until is not null;

-- Only the service role can read this table (RLS on, no policies).
create table if not exists public.internal_config (name text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.internal_config enable row level security;
revoke all on public.internal_config from anon, authenticated;

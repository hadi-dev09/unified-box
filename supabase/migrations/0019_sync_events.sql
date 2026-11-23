-- Delivery timing: when each message reached Unified Box, and a short log of sync events (names and times only).
alter table public.messages add column if not exists created_at timestamptz default now();
create table if not exists public.sync_events (
  id bigint generated always as identity primary key,
  account_id uuid references public.accounts(id) on delete cascade,
  kind text not null,
  detail text,
  at timestamptz not null default now()
);
create index if not exists sync_events_at_idx on public.sync_events (at);
alter table public.sync_events enable row level security;
revoke all on public.sync_events from anon, authenticated;

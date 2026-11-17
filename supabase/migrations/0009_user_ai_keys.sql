-- A user's own Claude API key for the in-app AI assistant. Encrypted by the app (AES-256-GCM); only the service role reads it.
create table if not exists public.user_ai_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'anthropic' check (provider in ('anthropic')),
  key_enc text not null,
  key_hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.user_ai_keys enable row level security;
revoke all on public.user_ai_keys from anon, authenticated;

-- OAuth 2.1 for the MCP connector (dynamic client registration + PKCE).
-- RLS is enabled with NO policies: only server code (service role) can touch these tables.
create table public.oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  resource text,
  expires_at timestamptz not null,
  used boolean not null default false
);

create table public.oauth_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('access','refresh')),
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_tokens_user on public.oauth_tokens (user_id, client_id);

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;

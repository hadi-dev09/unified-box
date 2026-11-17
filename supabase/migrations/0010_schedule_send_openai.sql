-- Schedule send: a reply waits as status 'scheduled' until send_at; the background job claims it ('sending') and sends it.
alter table public.drafts add column if not exists send_at timestamptz;
alter table public.drafts drop constraint if exists drafts_status_check;
alter table public.drafts add constraint drafts_status_check check (status in ('pending','scheduled','sending','approved','sent','rejected','failed'));
create index if not exists drafts_due on public.drafts (send_at) where status = 'scheduled';
-- AI assistant: allow an OpenAI key as well as Claude, and remember which model the key can use.
alter table public.user_ai_keys drop constraint if exists user_ai_keys_provider_check;
alter table public.user_ai_keys add constraint user_ai_keys_provider_check check (provider in ('anthropic','openai'));
alter table public.user_ai_keys add column if not exists model text;

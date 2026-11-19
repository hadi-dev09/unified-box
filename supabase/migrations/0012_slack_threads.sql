-- Slack threads: a reply stores its parent's ts; a draft can target a thread.
alter table public.messages add column if not exists thread_ts text;
alter table public.drafts add column if not exists reply_to text;

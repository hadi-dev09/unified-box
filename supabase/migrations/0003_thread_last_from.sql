-- Show who sent the latest message in the thread list.
alter table public.threads add column if not exists last_from text;

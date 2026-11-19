-- Slack threads you take part in become their own conversations (external_id "<channel>/<thread ts>"),
-- like Slack's Threads/Activity view. remote_checked_at rotates the once-a-minute read-state check.
alter table public.threads add column if not exists remote_checked_at timestamptz;

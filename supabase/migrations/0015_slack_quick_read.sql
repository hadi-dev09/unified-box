-- Throttle for the fast "read in Slack" check (at most one per account every few seconds).
alter table public.accounts add column if not exists read_checked_at timestamptz;

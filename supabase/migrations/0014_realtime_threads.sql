-- Instant screen updates: the app listens for changes to your conversations (row-level security limits it to yours).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'threads') then
    alter publication supabase_realtime add table public.threads;
  end if;
end $$;

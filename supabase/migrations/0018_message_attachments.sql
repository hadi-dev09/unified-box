-- Photos, videos, voice notes and files on chat messages (metadata only; the file is fetched on demand).
alter table public.messages add column if not exists attachments jsonb;

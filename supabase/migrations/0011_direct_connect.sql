-- research/direct-connect (NOT applied to the live database yet):
-- allow "WhatsApp (scan QR)" via a self-hosted gateway, and "Email with app password" (IMAP/SMTP).
alter table public.accounts drop constraint if exists accounts_provider_check;
alter table public.accounts add constraint accounts_provider_check
  check (provider in ('gmail','outlook','slack','whatsapp','whatsapp_web','imap','telegram','teams','sms','instagram','messenger','upwork','discord','google_chat'));

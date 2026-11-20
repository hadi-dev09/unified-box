import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { credsFor, encryptCreds, PRESETS, verifyMailbox, type ImapPreset } from "@/lib/imap";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncAccount } from "@/lib/sync";

export const maxDuration = 60;

// Connect a mailbox with its address + app password (IMAP to read, SMTP to send). Checked before saving; stored encrypted.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const preset = String(b.preset ?? "") as ImapPreset;
  if (!(preset in PRESETS) && preset !== "custom") return NextResponse.json({ error: "Pick your email provider" }, { status: 400 });
  const email = String(b.email ?? "").trim().toLowerCase();
  const pass = String(b.password ?? "").replace(/\s+/g, preset === "gmail" ? "" : " ").trim(); // Gmail shows app passwords in groups of 4
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return NextResponse.json({ error: "Enter your full email address" }, { status: 400 });
  if (pass.length < 4 || pass.length > 200) return NextResponse.json({ error: "Enter the app password" }, { status: 400 });
  const creds = credsFor(preset, email, pass, { imapHost: b.imapHost as string, imapPort: Number(b.imapPort), smtpHost: b.smtpHost as string, smtpPort: Number(b.smtpPort) });
  if (!creds) return NextResponse.json({ error: "Enter the IMAP and SMTP server names" }, { status: 400 });

  const v = await verifyMailbox(creds);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const db = supabaseAdmin();
  const { data: acct, error } = await db.from("accounts").upsert(
    { user_id: user.id, provider: "imap", account_type: "personal", display_name: email, external_id: email, status: "connected", status_detail: null, can_send: true, meta: { preset } },
    { onConflict: "user_id,provider,external_id" },
  ).select("id").single();
  if (error || !acct) return NextResponse.json({ error: "Couldn't save the account" }, { status: 500 });
  await db.from("account_secrets").upsert({ account_id: acct.id, tokens_enc: encryptCreds(creds) });
  await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "account.connected", target: email, meta: { provider: "imap", preset } });
  await syncAccount(acct.id).catch(() => null);
  return NextResponse.json({ ok: true, email });
}

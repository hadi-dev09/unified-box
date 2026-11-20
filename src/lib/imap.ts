import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { decrypt, encrypt } from "./crypto";
import type { GmailMsg, OutgoingMail } from "./gmail";
import { htmlToText, looksAutomated } from "./mail-text";
import { supabaseAdmin } from "./supabase/admin";

/**
 * "Email (IMAP)": connect any mailbox with the address + an app password, no Google/Microsoft app or verification.
 * Works for Gmail (with 2-step verification + an app password), Yahoo, iCloud, Zoho, Fastmail and most custom-domain
 * mail. Not for Outlook.com/Microsoft 365 (Microsoft turned off password logins for IMAP; that needs OAuth).
 */
export type ImapPreset = "gmail" | "yahoo" | "icloud" | "zoho" | "fastmail" | "custom";
type Server = { host: string; port: number; secure: boolean };
export type ImapCreds = { user: string; pass: string; imap: Server; smtp: Server };

export const PRESETS: Record<Exclude<ImapPreset, "custom">, { name: string; imap: Server; smtp: Server; help: string }> = {
  gmail: { name: "Gmail (app password)", imap: { host: "imap.gmail.com", port: 993, secure: true }, smtp: { host: "smtp.gmail.com", port: 465, secure: true }, help: "https://myaccount.google.com/apppasswords" },
  yahoo: { name: "Yahoo Mail", imap: { host: "imap.mail.yahoo.com", port: 993, secure: true }, smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true }, help: "https://login.yahoo.com/account/security" },
  icloud: { name: "iCloud Mail", imap: { host: "imap.mail.me.com", port: 993, secure: true }, smtp: { host: "smtp.mail.me.com", port: 587, secure: false }, help: "https://account.apple.com" },
  zoho: { name: "Zoho Mail", imap: { host: "imap.zoho.com", port: 993, secure: true }, smtp: { host: "smtp.zoho.com", port: 465, secure: true }, help: "https://accounts.zoho.com/home#security/app_password" },
  fastmail: { name: "Fastmail", imap: { host: "imap.fastmail.com", port: 993, secure: true }, smtp: { host: "smtp.fastmail.com", port: 465, secure: true }, help: "https://app.fastmail.com/settings/security/apps" },
};

const PRIVATE = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i, /^::ffff:(10|127|192\.168|169\.254)\./i];

/** Custom servers are user input: allow only public hosts on standard mail ports (no probing our own network). */
export async function safeServer(s: Server): Promise<string | null> {
  if (!/^[a-z0-9.-]{3,253}$/i.test(s.host) || /localhost|\.internal$|\.local$/i.test(s.host)) return "Enter a valid mail server name, e.g. imap.example.com";
  if (![993, 143, 465, 587].includes(s.port)) return "Use a standard mail port (993 for IMAP, 465 or 587 for SMTP).";
  try {
    const addrs = isIP(s.host) ? [{ address: s.host }] : await lookup(s.host, { all: true });
    if (!addrs.length || addrs.some((a) => PRIVATE.some((re) => re.test(a.address)))) return "That mail server isn't reachable from the internet.";
  } catch { return `Couldn't find the server ${s.host}.`; }
  return null;
}

export function credsFor(preset: ImapPreset, user: string, pass: string, custom?: { imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number }): ImapCreds | null {
  if (preset !== "custom") return { user, pass, imap: PRESETS[preset].imap, smtp: PRESETS[preset].smtp };
  if (!custom?.imapHost || !custom.smtpHost) return null;
  const imapPort = Number(custom.imapPort) || 993, smtpPort = Number(custom.smtpPort) || 465;
  return { user, pass, imap: { host: custom.imapHost.trim(), port: imapPort, secure: imapPort === 993 }, smtp: { host: custom.smtpHost.trim(), port: smtpPort, secure: smtpPort === 465 } };
}

const friendly = (e: unknown) => {
  const m = String((e as { responseText?: string; message?: string })?.responseText ?? (e as Error)?.message ?? e);
  if (/AUTHENTICATIONFAILED|Invalid credentials|authentication failed|Username and Password not accepted|535/i.test(m)) return "The email or app password is wrong. For Gmail, use a 16-letter app password, not your normal password.";
  if (/Application-specific password required|web login required/i.test(m)) return "This account needs an app password (your normal password won't work).";
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return "Couldn't find that mail server.";
  if (/ETIMEDOUT|ECONNREFUSED|timed out/i.test(m)) return "The mail server didn't answer. Check the server name and port.";
  return "Couldn't sign in to that mailbox. Check the details and try again.";
};

// Test hooks (like setTelegramFactory): swap the IMAP client / SMTP transport for fakes.
const g = globalThis as unknown as { __IMAP_FACTORY__?: (c: ImapCreds) => unknown; __SMTP_FACTORY__?: (c: ImapCreds) => unknown; __IMAP_SKIP_DNS__?: boolean };
export const setMailFactories = (imap?: (c: ImapCreds) => unknown, smtp?: (c: ImapCreds) => unknown) => { g.__IMAP_FACTORY__ = imap; g.__SMTP_FACTORY__ = smtp; g.__IMAP_SKIP_DNS__ = Boolean(imap); };

async function imapClient(c: ImapCreds) {
  if (g.__IMAP_FACTORY__) return g.__IMAP_FACTORY__(c) as import("imapflow").ImapFlow;
  const { ImapFlow } = await import("imapflow");
  return new ImapFlow({ host: c.imap.host, port: c.imap.port, secure: c.imap.secure, auth: { user: c.user, pass: c.pass }, logger: false, connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 40_000 });
}
async function smtpTransport(c: ImapCreds) {
  if (g.__SMTP_FACTORY__) return g.__SMTP_FACTORY__(c) as import("nodemailer").Transporter;
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport({ host: c.smtp.host, port: c.smtp.port, secure: c.smtp.secure, requireTLS: !c.smtp.secure, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15_000 });
}

/** Logs in to IMAP and SMTP once to prove the details work. */
export async function verifyMailbox(c: ImapCreds): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!g.__IMAP_SKIP_DNS__) for (const s of [c.imap, c.smtp]) { const bad = await safeServer(s); if (bad) return { ok: false, error: bad }; }
  const client = await imapClient(c);
  try { await client.connect(); await client.logout(); } catch (e) { return { ok: false, error: friendly(e) }; }
  try { await (await smtpTransport(c)).verify(); } catch (e) { return { ok: false, error: `Reading works, but sending failed: ${friendly(e)}` }; }
  return { ok: true };
}

export const encryptCreds = (c: ImapCreds) => encrypt(JSON.stringify(c));
async function credsOf(accountId: string): Promise<ImapCreds> {
  const { data } = await supabaseAdmin().from("account_secrets").select("tokens_enc").eq("account_id", accountId).single();
  if (!data) throw new Error("No stored credentials");
  return JSON.parse(decrypt(data.tokens_enc)) as ImapCreds;
}

const WINDOW_DAYS = 14;
const addr = (v?: { value?: { address?: string; name?: string }[] } | { value?: { address?: string; name?: string }[] }[]) =>
  (Array.isArray(v) ? v.flatMap((x) => x.value ?? []) : v?.value ?? []).map((a) => (a.address ?? "").toLowerCase()).filter(Boolean);

/** Reads the last 14 days of INBOX (read-only: nothing is marked read by syncing) and returns new messages by conversation. */
export async function imapRecent(accountId: string, self: string, known: (ids: string[]) => Promise<Set<string>>): Promise<{ msgs: GmailMsg[]; unreadIds: Set<string>; allIds: Map<string, string> }> {
  const c = await credsOf(accountId);
  const client = await imapClient(c);
  const { simpleParser } = await import("mailparser");
  await client.connect();
  const lock = await client.getMailboxLock("INBOX", { readOnly: true });
  try {
    const since = new Date(Date.now() - WINDOW_DAYS * 86400_000);
    const uids = ((await client.search({ since }, { uid: true })) || []) as number[];
    const recent = uids.slice(-200);
    const meta = new Map<number, { seen: boolean; thread?: string }>();
    if (recent.length) {
      for await (const m of client.fetch(recent.join(","), { uid: true, flags: true, threadId: true }, { uid: true })) {
        meta.set(m.uid, { seen: Boolean(m.flags?.has("\\Seen")), thread: m.threadId });
      }
    }
    const ids = recent.map((u) => `u${u}`);
    const have = await known(ids);
    const fresh = recent.filter((u) => !have.has(`u${u}`)).slice(-60);
    const msgs: GmailMsg[] = [];
    for (const uid of fresh) {
      const one = await client.fetchOne(String(uid), { uid: true, source: { maxLength: 2_000_000 } }, { uid: true });
      if (!one || !one.source) continue;
      const p = await simpleParser(one.source);
      const from = (p.from?.value ?? [])[0] ?? {};
      const fromAddr = (from.address ?? "").toLowerCase();
      const refs = (Array.isArray(p.references) ? p.references : p.references ? [p.references] : []).filter(Boolean) as string[];
      const thread = meta.get(uid)?.thread ?? refs[0] ?? p.inReplyTo ?? p.messageId ?? `u${uid}`;
      const body = (p.text?.trim() || (p.html ? htmlToText(String(p.html)) : "")).slice(0, 20_000);
      // raw header text (mailparser turns some headers, e.g. List-*, into objects)
      const header = (k: string) => (p.headerLines.find((h) => h.key === k)?.line ?? "").replace(/^[^:]*:\s*/, "");
      msgs.push({
        id: `u${uid}`, threadId: `t:${thread}`, subject: p.subject ?? "", fromName: from.name ?? "", fromAddr,
        to: addr(p.to as never), cc: addr(p.cc as never), messageId: p.messageId ?? "", body, sentAt: (p.date ?? new Date()).toISOString(),
        snippet: body.replace(/\s+/g, " ").slice(0, 200), unread: !meta.get(uid)?.seen, outgoing: fromAddr === self.toLowerCase(),
        automated: looksAutomated({ labels: [], fromAddr, listUnsubscribe: header("list-unsubscribe"), precedence: header("precedence"), autoSubmitted: header("auto-submitted") }),
      });
    }
    const unreadIds = new Set(recent.filter((u) => !meta.get(u)?.seen).map((u) => `u${u}`));
    const allIds = new Map(recent.map((u) => [`u${u}`, `t:${meta.get(u)?.thread ?? ""}`]));
    return { msgs, unreadIds, allIds };
  } finally {
    lock.release();
    await client.logout().catch(() => null);
  }
}

/** Sends with the mailbox's own SMTP server, threaded with In-Reply-To/References. */
export async function imapSend(accountId: string, m: OutgoingMail) {
  const c = await credsOf(accountId);
  const t = await smtpTransport(c);
  const safe = (s: string) => s.replace(/[\r\n]+/g, " ");
  const info = await t.sendMail({
    from: c.user, to: m.to.join(", "), cc: (m.cc ?? []).join(", ") || undefined, subject: safe(m.subject), text: m.body,
    inReplyTo: m.inReplyTo, references: m.references?.length ? m.references.slice(-20).join(" ") : undefined,
  });
  return { id: info.messageId };
}

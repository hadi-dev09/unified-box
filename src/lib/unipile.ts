import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import type { GmailMsg } from "./gmail";
import { htmlToText, looksAutomated } from "./mail-text";
import { supabaseAdmin } from "./supabase/admin";

/**
 * Unipile (unipile.com) connects people's accounts for us through its hosted sign-in page:
 * Gmail and Outlook through Unipile's own verified Google/Microsoft apps (no "unverified app" screen, no
 * Google review for us), WhatsApp by scanning a QR code (Unipile keeps the session running on its servers),
 * Telegram, Instagram, Messenger, LinkedIn and any IMAP mailbox (Yahoo, iCloud, …).
 * Endpoints and field names follow Unipile's official Node SDK (unipile-node-sdk 1.9.x).
 * Turned on by two settings from the Unipile dashboard: UNIPILE_DSN (e.g. api8.unipile.com:13851) and UNIPILE_API_KEY.
 */

export const unipileConfigured = () => Boolean(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY);

/** Our channel id → Unipile provider name. */
export const UNIPILE_PROVIDER: Record<string, string> = {
  gmail: "GOOGLE", outlook: "OUTLOOK", imap: "MAIL", whatsapp_web: "WHATSAPP", telegram: "TELEGRAM",
  instagram: "INSTAGRAM", messenger: "MESSENGER", linkedin: "LINKEDIN",
};
export const isUnipileEmail = (provider: string) => ["gmail", "outlook", "imap"].includes(provider);

const base = () => `https://${env("UNIPILE_DSN").replace(/^https?:\/\//, "").replace(/\/+$/, "")}/api/v1`;

export class UnipileError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function api<T = Record<string, unknown>>(method: string, path: string, o: { query?: Record<string, string>; json?: unknown; form?: FormData } = {}): Promise<T> {
  const qs = o.query && Object.keys(o.query).length ? `?${new URLSearchParams(o.query)}` : "";
  const headers: Record<string, string> = { "X-API-KEY": env("UNIPILE_API_KEY"), accept: "application/json" };
  if (o.json !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${base()}${path}${qs}`, { method, headers, body: o.form ?? (o.json !== undefined ? JSON.stringify(o.json) : undefined) });
  const j = (await r.json().catch(() => ({}))) as T & { title?: string; detail?: string; message?: string };
  if (!r.ok) throw new UnipileError(r.status, `Unipile ${method} ${path}: ${j.detail ?? j.title ?? j.message ?? r.status}`);
  return j;
}

// ---------- signed values (no extra secrets: derived from the app's encryption key) ----------

const secret = (purpose: string) => createHmac("sha256", env("TOKEN_ENCRYPTION_KEY")).update(`unipile:${purpose}`).digest();
const sign = (v: string) => createHmac("sha256", secret("state")).update(v).digest("hex").slice(0, 32);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const webhookKey = () => secret("webhook").toString("hex");
export const validWebhookKey = (k: string | null) => Boolean(k) && same(k!, webhookKey());

/** "<user id>.<channel>.<signature>": sent to Unipile as the account name and echoed back when the account is added. */
export function connectState(userId: string, provider: string) { const v = `${userId}.${provider}`; return `${v}.${sign(v)}`; }
export function readState(state: string | null | undefined): { userId: string; provider: string } | null {
  const m = String(state ?? "").match(/^([0-9a-f-]{36})\.([a-z_]+)\.([0-9a-f]{32})$/);
  return m && same(m[3], sign(`${m[1]}.${m[2]}`)) ? { userId: m[1], provider: m[2] } : null;
}

// ---------- connect ----------

/** A one-time link to Unipile's hosted page: Google/Microsoft sign-in, WhatsApp QR code, Telegram login, … */
export async function hostedConnectLink(userId: string, provider: string, reconnectId?: string): Promise<string> {
  const app = env("APP_URL");
  const state = connectState(userId, provider);
  const body = {
    ...(reconnectId ? { type: "reconnect", reconnect_account: reconnectId } : { type: "create", providers: [UNIPILE_PROVIDER[provider]] }),
    api_url: `https://${env("UNIPILE_DSN").replace(/^https?:\/\//, "")}`,
    expiresOn: new Date(Date.now() + 60 * 60_000).toISOString(),
    name: state,
    notify_url: `${app}/api/webhooks/unipile/connected`,
    success_redirect_url: `${app}/settings?connecting=${provider}`,
    failure_redirect_url: `${app}/settings?msg=${encodeURIComponent("The connection was cancelled or failed. Please try again.")}`,
  };
  const r = await api<{ url: string }>("POST", "/hosted/accounts/link", { json: body });
  return r.url;
}

type UAccount = { id: string; type?: string; name?: string; connection_params?: Record<string, Record<string, unknown> | undefined> };

/** The address/number we show for an account Unipile just connected. */
function identity(a: UAccount): string {
  const p = a.connection_params ?? {};
  const pick = (o?: Record<string, unknown>) => (o ? [o.email, o.username, o.phone_number, o.id].find((x) => typeof x === "string" && x) : undefined) as string | undefined;
  return pick(p.mail) ?? pick(p.im) ?? pick(p.chat) ?? a.name ?? a.id;
}

/** Called from the notify webhook: stores the new account for the user it belongs to and starts the first sync. */
export async function saveConnectedAccount(state: string, unipileId: string): Promise<{ accountId: string; userId: string } | null> {
  const who = readState(state);
  if (!who || !UNIPILE_PROVIDER[who.provider]) return null;
  const a = await api<UAccount>("GET", `/accounts/${encodeURIComponent(unipileId)}`);
  const id = identity(a);
  const db = supabaseAdmin();
  const { data, error } = await db.from("accounts").upsert({
    user_id: who.userId, provider: who.provider, account_type: "personal", display_name: id, external_id: id,
    remote_id: unipileId, status: "connected", status_detail: null, can_send: true,
  }, { onConflict: "user_id,provider,external_id" }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "account upsert failed");
  await db.from("audit_log").insert({ user_id: who.userId, actor: "user", action: "account.connected", target: id, meta: { provider: who.provider, via: "unipile" } });
  await ensureWebhooks().catch(() => null);
  return { accountId: data.id as string, userId: who.userId };
}

/** Registers our two webhooks (new/read messages, new emails) once per Unipile workspace. */
export async function ensureWebhooks() {
  const db = supabaseAdmin();
  const url = `${env("APP_URL")}/api/webhooks/unipile`;
  const { data } = await db.from("internal_config").select("value").eq("name", "unipile_webhooks").maybeSingle();
  if (data?.value === url) return;
  const headers = [{ key: "x-ub-key", value: webhookKey() }];
  await api("POST", "/webhooks", { json: { request_url: url, name: "Unified Box messages", source: "messaging", events: ["message_received", "message_read"], headers, format: "json" } });
  await api("POST", "/webhooks", { json: { request_url: url, name: "Unified Box email", source: "email", events: ["mail_received", "mail_sent"], headers, format: "json" } });
  await db.from("internal_config").upsert({ name: "unipile_webhooks", value: url, updated_at: new Date().toISOString() });
}

export async function unipileDisconnect(remoteId: string) {
  await api("DELETE", `/accounts/${encodeURIComponent(remoteId)}`).catch((e) => { if (!(e instanceof UnipileError && e.status === 404)) throw e; });
}

// ---------- read ----------

type UAttendee = { id?: string; provider_id?: string; name?: string; display_name?: string; is_self?: number | boolean };
type UEmail = {
  id: string; thread_id?: string; subject?: string; body?: string; body_plain?: string; date: string; message_id?: string; role?: string; folders?: string[];
  read_date?: string | null; from_attendee?: { display_name?: string; identifier: string }; to_attendees?: { identifier: string }[]; cc_attendees?: { identifier: string }[];
};
type UChat = { id: string; name?: string | null; type?: number; timestamp?: string | null; unread_count?: number; attendee_provider_id?: string };
type UMessage = { id: string; text?: string | null; sender_id?: string; is_sender?: number | boolean; timestamp: string; attachments?: { type?: string; file_name?: string }[]; is_event?: number | boolean; hidden?: number | boolean; deleted?: number | boolean };

export function emailToMsg(e: UEmail, self: string): GmailMsg {
  const from = e.from_attendee?.identifier ?? "";
  const body = (e.body_plain && e.body_plain.trim()) || htmlToText(e.body ?? "");
  const outgoing = e.role === "sent" || from.toLowerCase() === self.toLowerCase();
  return {
    id: e.id, threadId: e.thread_id || e.id, subject: e.subject ?? "", fromName: outgoing ? "You" : e.from_attendee?.display_name || from, fromAddr: from,
    to: (e.to_attendees ?? []).map((a) => a.identifier), cc: (e.cc_attendees ?? []).map((a) => a.identifier), messageId: e.message_id ?? "",
    body: body.slice(0, 20_000), sentAt: new Date(e.date).toISOString(), snippet: body.replace(/\s+/g, " ").slice(0, 160),
    unread: !outgoing && !e.read_date, outgoing, automated: !outgoing && looksAutomated({ labels: [], fromAddr: from, subject: e.subject }),
  };
}

const attachmentLabel = (m: UMessage) => {
  const a = m.attachments?.[0];
  if (!a) return "";
  return a.type === "img" ? "📷 Photo" : a.type === "video" ? "🎬 Video" : a.type === "audio" ? "🎤 Voice message" : `📎 ${a.file_name ?? "File"}`;
};

/** Pulls recent email (grouped into conversations) or recent chats for one Unipile-connected account. */
export async function unipileRecent(remoteId: string, provider: string, self: string, sinceIso: string | null): Promise<{ convs: { ext: string; title?: string; msgs: GmailMsg[]; unread: boolean }[] }> {
  if (isUnipileEmail(provider)) {
    const { items } = await api<{ items: UEmail[] }>("GET", "/emails", { query: { account_id: remoteId, limit: "50" } });
    const byThread = new Map<string, GmailMsg[]>();
    for (const e of items.filter((x) => !["drafts", "trash", "spam"].includes(x.role ?? ""))) {
      const m = emailToMsg(e, self);
      byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);
    }
    return { convs: [...byThread].map(([ext, msgs]) => ({ ext, msgs, unread: msgs.some((m) => m.unread) })) };
  }
  const { items: chats } = await api<{ items: UChat[] }>("GET", "/chats", { query: { account_id: remoteId, limit: "30" } });
  const since = sinceIso ? new Date(sinceIso).getTime() - 5 * 60_000 : 0;
  const convs: { ext: string; title?: string; msgs: GmailMsg[]; unread: boolean }[] = [];
  for (const c of chats.filter((x) => !x.timestamp || new Date(x.timestamp).getTime() >= since).slice(0, 20)) {
    const [{ items: msgs }, { items: people }] = await Promise.all([
      api<{ items: UMessage[] }>("GET", `/chats/${encodeURIComponent(c.id)}/messages`, { query: { limit: "30" } }),
      api<{ items: UAttendee[] }>("GET", `/chats/${encodeURIComponent(c.id)}/attendees`).catch(() => ({ items: [] as UAttendee[] })),
    ]);
    const nameOf = new Map<string, string>();
    for (const p of people) { const n = p.name || p.display_name; if (n) { if (p.provider_id) nameOf.set(p.provider_id, n); if (p.id) nameOf.set(p.id, n); } }
    const others = people.filter((p) => !p.is_self).map((p) => p.name || p.display_name).filter(Boolean) as string[];
    const title = c.name || others.join(", ") || (c.attendee_provider_id ? nameOf.get(c.attendee_provider_id) ?? c.attendee_provider_id.replace(/@.*$/, "") : "Chat");
    const unreadCount = c.unread_count ?? 0;
    const real = msgs.filter((m) => !m.is_event && !m.hidden && !m.deleted).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const incoming = real.filter((m) => !m.is_sender);
    const unreadIds = new Set(unreadCount ? incoming.slice(-unreadCount).map((m) => m.id) : []);
    const list = real.map((m): GmailMsg => {
      const text = (m.text ?? "").trim() || attachmentLabel(m) || "Message";
      const mine = Boolean(m.is_sender);
      return {
        id: `${c.id}:${m.id}`, threadId: c.id, subject: title, fromName: mine ? "You" : nameOf.get(m.sender_id ?? "") ?? title, fromAddr: mine ? self : m.sender_id ?? "",
        to: [], cc: [], messageId: "", body: text.slice(0, 20_000), sentAt: new Date(m.timestamp).toISOString(), snippet: text.slice(0, 160),
        unread: unreadIds.has(m.id), outgoing: mine, automated: false,
      };
    });
    if (list.length) convs.push({ ext: c.id, title, msgs: list, unread: unreadCount > 0 });
  }
  return { convs };
}

// ---------- write ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function unipileSendEmail(remoteId: string, m: { to: string[]; cc: string[]; subject: string; body: string; replyToId?: string }) {
  const f = new FormData();
  f.append("account_id", remoteId);
  f.append("to", JSON.stringify(m.to.map((identifier) => ({ identifier }))));
  if (m.cc.length) f.append("cc", JSON.stringify(m.cc.map((identifier) => ({ identifier }))));
  f.append("subject", m.subject);
  f.append("body", `<div>${esc(m.body).replace(/\n/g, "<br>")}</div>`);
  if (m.replyToId) f.append("reply_to", m.replyToId);
  return api<{ tracking_id?: string; provider_id?: string }>("POST", "/emails", { form: f });
}

export async function unipileSendChat(chatId: string, text: string): Promise<{ id: string }> {
  const f = new FormData();
  f.append("text", text);
  const r = await api<{ message_id?: string; id?: string }>("POST", `/chats/${encodeURIComponent(chatId)}/messages`, { form: f });
  return { id: r.message_id ?? r.id ?? `local-${Date.now()}` };
}

/** Mirrors read/unread: the newest incoming email of the conversation, or the chat itself. */
export async function unipileMark(provider: string, externalThreadId: string, newestEmailId: string | null, read: boolean) {
  if (isUnipileEmail(provider)) {
    if (newestEmailId) await api("PUT", `/emails/${encodeURIComponent(newestEmailId)}`, { json: { unread: !read } });
  } else {
    await api("PATCH", `/chats/${encodeURIComponent(externalThreadId)}`, { json: { action: "setReadStatus", value: read } });
  }
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import type { GmailMsg, MsgAttachment } from "./gmail";
import { htmlToText, looksAutomated } from "./mail-text";
import { supabaseAdmin } from "./supabase/admin";

/**
 * Unipile (unipile.com, API v2) connects people's accounts through its hosted sign-in page:
 * Gmail and Outlook through Unipile's own verified Google/Microsoft apps (no "unverified app" screen, no
 * Google review for us), WhatsApp by scanning a QR code (Unipile keeps the session running), Telegram,
 * Instagram, Messenger, LinkedIn and any IMAP mailbox (Yahoo, iCloud, …).
 * Endpoints and fields follow Unipile's v2 OpenAPI reference (base https://api.unipile.com, header X-API-KEY).
 * Turned on by one setting from the Unipile dashboard: UNIPILE_API_KEY.
 */

export const unipileConfigured = () => Boolean(process.env.UNIPILE_API_KEY);

/** Our channel id → Unipile provider. */
export const UNIPILE_PROVIDER: Record<string, string> = {
  gmail: "google", outlook: "outlook", imap: "imap", whatsapp_web: "whatsapp", telegram: "telegram",
  instagram: "instagram", messenger: "facebook", linkedin: "linkedin",
};
const OUR_PROVIDER = Object.fromEntries(Object.entries(UNIPILE_PROVIDER).map(([a, b]) => [b, a]));
export const isUnipileEmail = (provider: string) => ["gmail", "outlook", "imap"].includes(provider);

const base = () => (process.env.UNIPILE_BASE_URL || "https://api.unipile.com").replace(/\/+$/, "");
const seg = encodeURIComponent;

export class UnipileError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function api<T = Record<string, unknown>>(method: string, path: string, o: { query?: Record<string, string>; json?: unknown; service?: boolean } = {}): Promise<T> {
  const qs = o.query && Object.keys(o.query).length ? `?${new URLSearchParams(o.query)}` : "";
  // Registering webhooks needs a "service" key (created in the Unipile dashboard); everything else uses the normal key.
  const key = o.service && process.env.UNIPILE_SERVICE_KEY ? process.env.UNIPILE_SERVICE_KEY : env("UNIPILE_API_KEY");
  const headers: Record<string, string> = { "X-API-KEY": key, accept: "application/json" };
  if (o.json !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${base()}${path}${qs}`, { method, headers, body: o.json !== undefined ? JSON.stringify(o.json) : undefined });
  const j = (await r.json().catch(() => ({}))) as T & { title?: string; detail?: string; message?: string };
  if (!r.ok) throw new UnipileError(r.status, `Unipile ${method} ${path.replace(/acc_[\w-]+/g, "acc_…")}: ${j.detail ?? j.title ?? j.message ?? r.status}`);
  return j;
}

// ---------- signed values (no extra secrets: derived from the app's encryption key) ----------

const secret = (purpose: string) => createHmac("sha256", env("TOKEN_ENCRYPTION_KEY")).update(`unipile:${purpose}`).digest();
const sign = (v: string) => createHmac("sha256", secret("state")).update(v).digest("hex").slice(0, 32);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const webhookKey = () => secret("webhook").toString("hex");
export const validWebhookKey = (k: string | null) => Boolean(k) && same(k!, webhookKey());

/** "<user id>.<channel>.<signature>": given to Unipile and handed back when the account is added. */
export function connectState(userId: string, provider: string) { const v = `${userId}.${provider}`; return `${v}.${sign(v)}`; }
export function readState(state: string | null | undefined): { userId: string; provider: string } | null {
  const m = String(state ?? "").match(/^([0-9a-f-]{36})\.([a-z_]+)\.([0-9a-f]{32})$/);
  return m && same(m[3], sign(`${m[1]}.${m[2]}`)) ? { userId: m[1], provider: m[2] } : null;
}

// ---------- connect ----------

/** A one-time link to Unipile's hosted page: Google/Microsoft sign-in, WhatsApp QR code, Telegram login, … */
export async function hostedConnectLink(userId: string, provider: string, reconnectId?: string): Promise<string> {
  const body = {
    expires_on: new Date(Date.now() + 60 * 60_000).toISOString(),
    redirect_uri: `${env("APP_URL")}/api/connect/hosted/done`,
    state: connectState(userId, provider),
    ...(reconnectId ? { account_id: reconnectId } : { providers: [UNIPILE_PROVIDER[provider]] }),
  };
  return (await api<{ link: string }>("POST", "/v2/auth/link", { json: body })).link;
}

type UAccount = { id: string; provider: string; name?: string; created_at?: string; status?: string };

/**
 * Stores an account Unipile just connected, for the user the signed state names. The account must be the kind that
 * user asked for and either brand new (linked in the last 30 minutes) or already theirs, so nobody can attach an
 * account they don't own by pasting its id.
 */
export async function saveConnectedAccount(state: string, unipileId: string): Promise<{ accountId: string; userId: string; provider: string } | null> {
  const who = readState(state);
  if (!who || !UNIPILE_PROVIDER[who.provider] || !/^acc_[\w-]+$/.test(unipileId)) return null;
  const a = await api<UAccount>("GET", `/v2/accounts/${seg(unipileId)}`);
  if (OUR_PROVIDER[a.provider] !== who.provider) return null;
  const db = supabaseAdmin();
  const { data: owners } = await db.from("accounts").select("id, user_id").eq("remote_id", unipileId);
  const owned = (owners ?? []) as { id: string; user_id: string }[];
  if (owned.some((o) => o.user_id !== who.userId)) return null;
  const fresh = a.created_at && Date.now() - new Date(a.created_at).getTime() < 30 * 60_000;
  if (!fresh && !owned.length) return null;
  const id = a.name || unipileId;
  const { data, error } = await db.from("accounts").upsert({
    user_id: who.userId, provider: who.provider, account_type: "personal", display_name: id, external_id: id,
    remote_id: unipileId, status: "connected", status_detail: null, can_send: true,
  }, { onConflict: "user_id,provider,external_id" }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "account upsert failed");
  await db.from("audit_log").insert({ user_id: who.userId, actor: "user", action: "account.connected", target: id, meta: { provider: who.provider, via: "unipile" } });
  await ensureWebhooks().catch(() => null);
  return { accountId: data.id as string, userId: who.userId, provider: who.provider };
}

/** Registers our webhook once per Unipile application (new messages/emails, read changes, account status). */
export async function ensureWebhooks() {
  const db = supabaseAdmin();
  const url = `${env("APP_URL")}/api/webhooks/unipile?k=${webhookKey()}`;
  const marker = createHmac("sha256", secret("marker")).update(url).digest("hex").slice(0, 16);
  const { data } = await db.from("internal_config").select("value").eq("name", "unipile_webhook").maybeSingle();
  if (data?.value === marker) return;
  try {
    // Reuse ours if it already exists (e.g. a previous attempt that timed out after Unipile saved it).
    const list = await api<{ data?: { url: string }[] }>("GET", "/v2/webhooks/endpoints/", { service: true }).catch(() => ({ data: [] as { url: string }[] }));
    if (!(list.data ?? []).some((w) => w.url === url)) {
      await api("POST", "/v2/webhooks/endpoints/", { service: true, json: {
        url, description: "Unified Box",
        trigger_events: ["message.new", "message.update", "chat.update", "email.new", "email.update", "account.add", "account.reconnect", "account.status.disconnected", "account.status.running"],
      } });
    }
    await db.from("internal_config").upsert({ name: "unipile_webhook", value: marker, updated_at: new Date().toISOString() });
    await db.from("internal_config").delete().eq("name", "unipile_webhook_error");
  } catch (e) {
    // Keep the reason visible for diagnosis (never contains the key: the URL's key is masked).
    const msg = String((e as Error).message).replace(/k=[0-9a-f]+/g, "k=…").slice(0, 500);
    await db.from("internal_config").upsert({ name: "unipile_webhook_error", value: msg, updated_at: new Date().toISOString() });
    throw e;
  }
}

export async function unipileDisconnect(remoteId: string) {
  await api("DELETE", `/v2/accounts/${seg(remoteId)}`).catch((e) => { if (!(e instanceof UnipileError && e.status === 404)) throw e; });
}

// ---------- read ----------

type Attendee = { email: string; display_name?: string };
type UEmail = {
  id: string; thread_id?: string; subject?: string; body?: string; body_plain?: string; snippet?: string; date: string; message_id?: string;
  folders?: string[]; is_unread?: boolean; from?: Attendee[]; to?: Attendee[]; cc?: Attendee[];
};
type UChat = { id: string; name?: string; last_message_timestamp?: string; updated_at?: string; unread_count?: number; is_archived?: boolean };
type UMessage = {
  id: string; text?: string; sender_id?: string; sender?: { display_name?: string }; is_sender?: boolean; timestamp: string;
  attachments?: { id?: string; type?: string; filename?: string; mimetype?: string; voice_note?: boolean; is_unavailable?: boolean }[]; is_event?: boolean; is_hidden?: boolean; is_deleted?: boolean;
  event_type?: number; specifics?: unknown;
};

const toAttachments = (m: UMessage): MsgAttachment[] | undefined => {
  const list = (m.attachments ?? []).filter((a) => a.id && !a.is_unavailable).map((a): MsgAttachment => ({
    id: a.id!, type: a.type === "img" || a.type === "video" || a.type === "audio" || a.type === "file" ? a.type : "other",
    ...(a.filename ? { name: a.filename } : {}), ...(a.mimetype ? { mime: a.mimetype } : {}), ...(a.voice_note ? { voice: true } : {}),
  }));
  return list.length ? list : undefined;
};

const SKIP_FOLDER = /^(trash|spam|junk|drafts?|deleteditems)$/i;

export function emailToMsg(e: UEmail, self: string): GmailMsg {
  const from = e.from?.[0]?.email ?? "";
  const body = (e.body_plain && e.body_plain.trim()) || htmlToText(e.body ?? "") || e.snippet || "";
  const outgoing = from.toLowerCase() === self.toLowerCase() || (e.folders ?? []).some((f) => /^sent/i.test(f));
  return {
    id: e.id, threadId: e.thread_id || e.id, subject: e.subject ?? "", fromName: outgoing ? "You" : e.from?.[0]?.display_name || from, fromAddr: from,
    to: (e.to ?? []).map((a) => a.email), cc: (e.cc ?? []).map((a) => a.email), messageId: e.message_id ?? "",
    body: body.slice(0, 20_000), sentAt: new Date(e.date).toISOString(), snippet: body.replace(/\s+/g, " ").slice(0, 160),
    unread: !outgoing && Boolean(e.is_unread), outgoing, automated: !outgoing && looksAutomated({ labels: [], fromAddr: from, subject: e.subject }),
  };
}

const attachmentLabel = (m: UMessage) => {
  const a = m.attachments?.[0];
  if (!a) return "";
  return a.type === "img" ? "📷 Photo" : a.type === "video" ? "🎬 Video" : a.type === "audio" ? "🎤 Voice message" : a.type === "contact_card" ? "👤 Contact" : a.type === "shared_content" ? "🔗 Shared link" : `📎 ${a.filename ?? "File"}`;
};

type Conv = { ext: string; title?: string; msgs: GmailMsg[]; unread: boolean };

/** One chat's recent messages as a conversation. */
async function chatConv(acc: string, c: UChat, self: string): Promise<Conv | null> {
  const mraw = await api<{ data?: UMessage[]; items?: UMessage[] }>("GET", `/v2/${acc}/chats/${seg(c.id)}/messages`, { query: { limit: "50" } });
  const msgs = mraw.data ?? mraw.items ?? [];
  const title = c.name || "Chat";
  const unreadCount = Math.max(0, c.unread_count ?? 0);
  const real = msgs.filter((m) => !m.is_event && !m.is_hidden && !m.is_deleted).sort((x, y) => x.timestamp.localeCompare(y.timestamp));
  const unreadIds = new Set(unreadCount ? real.filter((m) => !m.is_sender).slice(-unreadCount).map((m) => m.id) : []);
  const list = real.map((m): GmailMsg => {
    const text = (m.text ?? "").trim() || attachmentLabel(m) || "WhatsApp doesn't share this message with linked devices. Open WhatsApp on your phone to see it.";
    const mine = Boolean(m.is_sender);
    return {
      id: `${c.id}:${m.id}`, threadId: c.id, subject: title, fromName: mine ? "You" : m.sender?.display_name || title, fromAddr: mine ? self : m.sender_id ?? "",
      to: [], cc: [], messageId: "", body: text.slice(0, 20_000), sentAt: new Date(m.timestamp).toISOString(), snippet: text.slice(0, 160),
      unread: unreadIds.has(m.id), outgoing: mine, automated: false, attachments: toAttachments(m),
    };
  });
  // unread_count -1 = marked unread by hand.
  return list.length ? { ext: c.id, title, msgs: list, unread: (c.unread_count ?? 0) !== 0 } : null;
}

/**
 * Pulls recent email (grouped into conversations) or recent chats for one Unipile-connected account.
 * For chats it also returns every listed chat's read state, so "read on the phone" shows here without
 * downloading messages again.
 */
export async function unipileRecent(remoteId: string, provider: string, self: string, sinceIso: string | null, connectedAt?: string | null): Promise<{ convs: Conv[]; readState: { ext: string; unread: boolean }[] }> {
  const acc = seg(remoteId);
  if (isUnipileEmail(provider)) {
    const { data } = await api<{ data: UEmail[] }>("GET", `/v2/${acc}/emails`, { query: { limit: "50" } });
    const byThread = new Map<string, GmailMsg[]>();
    for (const e of data.filter((x) => !(x.folders ?? []).some((f) => SKIP_FOLDER.test(f)))) {
      const m = emailToMsg(e, self);
      byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);
    }
    return { convs: [...byThread].map(([ext, msgs]) => ({ ext, msgs, unread: msgs.some((m) => m.unread) })), readState: [] };
  }
  const raw = await api<{ data?: UChat[]; items?: UChat[] }>("GET", `/v2/${acc}/chats`, { query: { limit: "40" } });
  const chats = raw.data ?? raw.items ?? [];
  const live = chats.filter((c) => !c.is_archived);
  // For the first hour Unipile is still copying history from the phone, so re-read every chat each time.
  const settling = connectedAt && Date.now() - new Date(connectedAt).getTime() < 60 * 60_000;
  const since = sinceIso && !settling ? new Date(sinceIso).getTime() - 5 * 60_000 : 0;
  const when = (c: UChat) => c.last_message_timestamp ?? c.updated_at;
  // Chats with a newer message, plus (when Unipile gives no time) the most recent ones, which the list is sorted by.
  const pick = since
    ? live.filter((c, i) => (when(c) ? new Date(when(c)!).getTime() >= since : i < 10)).slice(0, 20)
    : live.slice(0, 25);
  const convs: Conv[] = [];
  for (const c of pick) { const conv = await chatConv(acc, c, self); if (conv) convs.push(conv); }
  return { convs, readState: live.map((c) => ({ ext: c.id, unread: (c.unread_count ?? 0) !== 0 })) };
}

/** Just one chat, right after Unipile tells us it has a new message. */
export async function unipileOneChat(remoteId: string, chatId: string, self: string): Promise<Conv | null> {
  const acc = seg(remoteId);
  const c = await api<UChat>("GET", `/v2/${acc}/chats/${seg(chatId)}`);
  return chatConv(acc, { ...c, id: c.id || chatId }, self);
}

/** Finds a value by key anywhere in a webhook payload (e.g. chat_id). */
export function payloadValue(b: unknown, key: string): string | null {
  const walk = (v: unknown, depth: number): string | null => {
    if (depth > 4 || !v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o[key] === "string" && o[key]) return o[key] as string;
    for (const x of Object.values(o)) { const r = walk(x, depth + 1); if (r) return r; }
    return null;
  };
  return walk(b, 0);
}

// ---------- write ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function unipileSendEmail(remoteId: string, m: { to: string[]; cc: string[]; subject: string; body: string; replyToId?: string }) {
  return api<{ id?: string }>("POST", `/v2/${seg(remoteId)}/emails/send`, { json: {
    to: m.to.map((email) => ({ email })), ...(m.cc.length ? { cc: m.cc.map((email) => ({ email })) } : {}),
    subject: m.subject, plain_text: m.body, html: `<div>${esc(m.body).replace(/\n/g, "<br>")}</div>`,
    ...(m.replyToId ? { reply_to_provider_id: m.replyToId } : {}),
  } });
}

export async function unipileSendChat(remoteId: string, chatId: string, text: string): Promise<{ id: string }> {
  const r = await api<{ message_id?: string | string[] | null }>("POST", `/v2/${seg(remoteId)}/chats/${seg(chatId)}/messages/send`, { json: { text } });
  const id = Array.isArray(r.message_id) ? r.message_id[0] : r.message_id;
  return { id: id ?? `local-${Date.now()}` };
}

/** Mirrors read/unread: the newest incoming email of the conversation, or the chat itself. */
export async function unipileMark(remoteId: string, provider: string, externalThreadId: string, newestEmailId: string | null, read: boolean) {
  const acc = seg(remoteId);
  if (isUnipileEmail(provider)) {
    if (newestEmailId) await api("POST", `/v2/${acc}/emails/${seg(newestEmailId)}/${read ? "read" : "unread"}`);
  } else {
    await api("PATCH", `/v2/${acc}/chats/${seg(externalThreadId)}`, { json: { read_status: read } });
  }
}

/** Finds the Unipile account id in a webhook payload, wherever the event puts it. */
export function payloadAccountId(b: unknown): string | null {
  const walk = (v: unknown, parent: string, depth: number): string | null => {
    if (depth > 4 || !v || typeof v !== "object") return null;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === "string" && /^acc_[\w-]+$/.test(x) && (/account/.test(k) || (k === "id" && /account/.test(parent)))) return x;
    }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { const r = walk(x, k, depth + 1); if (r) return r; }
    return null;
  };
  return walk(b, "", 0);
}

/**
 * Fast check while the app is open (every few seconds): one chat-list request, then only the chats with a newer
 * message are downloaded, and read/unread from the phone is mirrored. At most once every 4 seconds per account.
 */
export async function quickUnipileCheck(accountId: string): Promise<number> {
  const db = supabaseAdmin();
  const { data: a } = await db.from("accounts").select("id, user_id, provider, external_id, remote_id, read_checked_at").eq("id", accountId).maybeSingle();
  if (!a?.remote_id || isUnipileEmail(a.provider)) return 0;
  if (a.read_checked_at && Date.now() - new Date(a.read_checked_at).getTime() < 4000) return 0;
  await db.from("accounts").update({ read_checked_at: new Date().toISOString() }).eq("id", accountId);
  const acc = seg(a.remote_id);
  const { data: chats } = await api<{ data: UChat[] }>("GET", `/v2/${acc}/chats`, { query: { limit: "20" } });
  const live = chats.filter((c) => !c.is_archived);
  if (!live.length) return 0;
  const { data: rows } = await db.from("threads").select("id, external_id, unread, last_message_at, seen_at").eq("account_id", accountId).in("external_id", live.map((c) => c.id));
  const known = new Map(((rows ?? []) as { id: string; external_id: string; unread: boolean; last_message_at: string; seen_at: string | null }[]).map((t) => [t.external_id, t]));
  const newer = live.filter((c) => {
    const t = known.get(c.id), at = c.last_message_timestamp ?? c.updated_at;
    return !t || (at && new Date(at).getTime() > new Date(t.last_message_at).getTime() + 999);
  }).slice(0, 5);
  let changed = 0;
  if (newer.length) {
    const { storeConversation } = await import("./sync");
    const { loadRules } = await import("./clients");
    const rules = await loadRules(a.user_id);
    for (const c of newer) {
      const conv = await chatConv(acc, c, a.external_id);
      if (conv) { await storeConversation(a, conv.ext, conv.msgs, conv.unread, rules, conv.title); changed++; }
    }
  }
  for (const c of live) {
    const t = known.get(c.id);
    if (!t || newer.includes(c)) continue;
    const u = (c.unread_count ?? 0) !== 0;
    // Just read here: WhatsApp may take a few seconds to apply it, so don't flip it back meanwhile.
    if (u && t.seen_at && Date.now() - new Date(t.seen_at).getTime() < 60_000) continue;
    if (u !== t.unread) { await db.from("threads").update({ unread: u, ...(u ? {} : { seen_at: new Date().toISOString() }) }).eq("id", t.id); changed++; }
  }
  return changed;
}

/** Streams one chat attachment from Unipile (photo, video, voice note, file). */
export async function unipileAttachment(remoteId: string, chatId: string, messageId: string, attachmentId: string): Promise<Response> {
  return fetch(`${base()}/v2/${seg(remoteId)}/chats/${seg(chatId)}/messages/${seg(messageId)}/attachments/${seg(attachmentId)}`, {
    headers: { "X-API-KEY": env("UNIPILE_API_KEY") },
  });
}

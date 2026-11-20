import { decrypt, encrypt } from "./crypto";
import { loadRules } from "./clients";
import type { GmailMsg } from "./gmail";
import { supabaseAdmin } from "./supabase/admin";

// Telegram user-account access through Telegram's official API (MTProto) using the gramjs library.
// Requires an api_id / api_hash from my.telegram.org (set once by the app owner as env vars).

export const telegramConfigured = () => Boolean(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH);

/** The small surface of the gramjs client we use (lets tests inject a fake). */
export type TgDialog = { id: string; title: string; unreadCount: number; isUser: boolean; isGroup: boolean; isChannel: boolean; isBot?: boolean; entity: unknown; date: number };
export type TgMessage = { id: number; text: string; date: number; out: boolean; senderId: string; senderName: string };
export interface TgClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  saveSession(): string;
  sendCode(phone: string): Promise<{ phoneCodeHash: string }>;
  signIn(phone: string, phoneCodeHash: string, code: string): Promise<"ok" | "password">;
  checkPassword(password: string): Promise<void>;
  me(): Promise<{ id: string; name: string; username?: string }>;
  dialogs(limit: number): Promise<TgDialog[]>;
  messages(d: TgDialog, limit: number): Promise<TgMessage[]>;
  send(d: TgDialog, text: string): Promise<{ id: number; date: number }>;
  logOut(): Promise<void>;
}

type Factory = (session: string) => Promise<TgClient>;
const g = globalThis as unknown as { __TG_FACTORY__?: Factory };
/** Test hook: replace the real client. */
export const setTelegramFactory = (f: Factory | undefined) => { g.__TG_FACTORY__ = f; };

async function realClient(session: string): Promise<TgClient> {
  const { TelegramClient, Api, sessions, password: pwd } = await import("teleproto");
  const { StringSession } = sessions;
  const apiId = Number(process.env.TELEGRAM_API_ID), apiHash = String(process.env.TELEGRAM_API_HASH);
  const c = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 2 });
  c.setLogLevel("error" as never);
  const name = (u: { firstName?: string; lastName?: string; title?: string } | undefined) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.title || "";
  return {
    connect: async () => { await c.connect(); },
    disconnect: async () => { await c.disconnect(); },
    saveSession: () => String(c.session.save()),
    sendCode: async (phone) => {
      const r = await c.invoke(new Api.auth.SendCode({ phoneNumber: phone, apiId, apiHash, settings: new Api.CodeSettings({}) }));
      return { phoneCodeHash: (r as { phoneCodeHash: string }).phoneCodeHash };
    },
    signIn: async (phone, phoneCodeHash, code) => {
      try { await c.invoke(new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code })); return "ok"; }
      catch (e) { if (/SESSION_PASSWORD_NEEDED/.test(String((e as Error).message))) return "password"; throw e; }
    },
    checkPassword: async (password) => {
      const { computeCheck } = pwd;
      const pw = await c.invoke(new Api.account.GetPassword());
      await c.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pw, password) }));
    },
    me: async () => { const u = await c.getMe() as unknown as { id: { toString(): string }; firstName?: string; lastName?: string; username?: string }; return { id: u.id.toString(), name: name(u), username: u.username }; },
    dialogs: async (limit) => (await c.getDialogs({ limit })).map((d) => ({
      id: String(d.id), title: d.title ?? d.name ?? "Chat", unreadCount: d.unreadCount ?? 0, isUser: Boolean(d.isUser), isGroup: Boolean(d.isGroup),
      isChannel: Boolean(d.isChannel) && !d.isGroup, isBot: Boolean((d.entity as { bot?: boolean } | undefined)?.bot), entity: d.entity, date: d.date ?? 0,
    })),
    messages: async (d, limit) => {
      const ms = await c.getMessages(d.entity as never, { limit });
      return Promise.all(ms.map(async (m) => {
        const s = m.out ? undefined : await m.getSender().catch(() => undefined);
        return { id: m.id, text: m.message || (m.media ? "[attachment]" : ""), date: m.date, out: Boolean(m.out), senderId: String(m.senderId ?? ""), senderName: name(s as never) };
      }));
    },
    send: async (d, text) => { const m = await c.sendMessage(d.entity as never, { message: text }); return { id: m.id, date: m.date }; },
    logOut: async () => { await c.invoke(new Api.auth.LogOut()); },
  };
}

export const telegramClient = (session: string) => (g.__TG_FACTORY__ ?? realClient)(session);

/** Telegram phone numbers in international format, digits only after "+". */
export const normalizePhone = (raw: string) => { const d = raw.replace(/[^\d+]/g, ""); return /^\+\d{7,15}$/.test(d) ? d : null; };

async function sessionFor(accountId: string) {
  const { data } = await supabaseAdmin().from("account_secrets").select("tokens_enc").eq("account_id", accountId).single();
  if (!data) throw new Error("No stored session");
  return (JSON.parse(decrypt(data.tokens_enc)) as { session: string }).session;
}
export const encryptSession = (session: string) => encrypt(JSON.stringify({ session }));

const RECENT_MS = 14 * 86400_000;

/** Reads recent private chats and small groups (skips broadcast channels) into Unified Box. */
export async function syncTelegram(acct: { id: string; user_id: string; external_id: string }) {
  const { storeConversation } = await import("./sync");
  const db = supabaseAdmin();
  const client = await telegramClient(await sessionFor(acct.id));
  await client.connect();
  try {
    const dialogs = (await client.dialogs(40)).filter((d) => !d.isChannel && Date.now() - d.date * 1000 < RECENT_MS);
    const rules = await loadRules(acct.user_id);
    const { data: before } = await db.from("threads").select("external_id, unread, last_message_at").eq("account_id", acct.id);
    const prior = new Map((before ?? []).map((t: { external_id: string; unread: boolean; last_message_at: string }) => [t.external_id, t]));
    let synced = 0;
    for (const d of dialogs) {
      const ms = (await client.messages(d, 20)).filter((m) => m.text);
      if (!ms.length) continue;
      const list: GmailMsg[] = ms.map((m) => ({
        id: `${d.id}:${m.id}`, threadId: d.id, subject: d.title, fromName: m.out ? "You" : m.senderName || d.title, fromAddr: m.out ? acct.external_id : m.senderId,
        to: [], cc: [], messageId: "", body: m.text.slice(0, 20_000), sentAt: new Date(m.date * 1000).toISOString(), snippet: m.text.slice(0, 200),
        unread: false, outgoing: m.out, automated: Boolean(d.isBot),
      }));
      await storeConversation(acct, d.id, list, d.unreadCount > 0, rules, d.isGroup ? `${d.title} (group)` : d.title);
      synced += list.length;
    }
    const { data: after } = await db.from("threads").select("external_id, unread, last_message_at").eq("account_id", acct.id);
    const changed = (after ?? []).some((t: { external_id: string; unread: boolean; last_message_at: string }) => {
      const p = prior.get(t.external_id); return !p || p.unread !== t.unread || p.last_message_at !== t.last_message_at;
    });
    return { accountId: acct.id, synced, changed, unread: dialogs.filter((d) => d.unreadCount > 0).length };
  } finally { await client.disconnect().catch(() => {}); }
}

/** Sends a text into an existing Telegram chat. Returns the sent message id/time. */
export async function telegramSend(accountId: string, chatId: string, text: string) {
  const client = await telegramClient(await sessionFor(accountId));
  await client.connect();
  try {
    const d = (await client.dialogs(100)).find((x) => x.id === chatId);
    if (!d) throw new Error("That Telegram chat isn't in your recent chats anymore.");
    return await client.send(d, text);
  } finally { await client.disconnect().catch(() => {}); }
}

export async function telegramLogOut(accountId: string) {
  const client = await telegramClient(await sessionFor(accountId));
  await client.connect();
  try { await client.logOut(); } finally { await client.disconnect().catch(() => {}); }
}

import { createHmac, timingSafeEqual } from "node:crypto";
import type { GmailMsg } from "./gmail";

/**
 * "WhatsApp (scan QR)": links a person's normal WhatsApp or WhatsApp Business app as a linked device, through a
 * self-hosted WAHA gateway (https://github.com/devlikeapro/waha, Apache-2.0). No Meta app needed.
 * The gateway must run 24/7 on its own server (Vercel can't keep WhatsApp connections open).
 *
 * Env: WA_GATEWAY_URL (e.g. https://wa.example.com), WA_GATEWAY_KEY (the gateway's X-Api-Key),
 *      WA_GATEWAY_WEBHOOK_SECRET (HMAC key the gateway signs webhooks with).
 */
export const waGatewayConfigured = () => Boolean(process.env.WA_GATEWAY_URL && process.env.WA_GATEWAY_KEY && process.env.WA_GATEWAY_WEBHOOK_SECRET);

export type GatewayStatus = "STOPPED" | "STARTING" | "SCAN_QR_CODE" | "PASSKEY_REQUIRED" | "PASSKEY_CONFIRMATION_REQUIRED" | "WORKING" | "FAILED";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = String(process.env.WA_GATEWAY_URL).replace(/\/+$/, "");
  const r = await fetch(`${base}${path}`, {
    ...init,
    headers: { "x-api-key": String(process.env.WA_GATEWAY_KEY), accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`WhatsApp gateway ${r.status}${r.status === 401 ? " (check WA_GATEWAY_KEY)" : ""}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Session names are ours (never user input): "ub" + random hex. */
export const validSessionName = (s: unknown): s is string => typeof s === "string" && /^ub[a-f0-9]{20}$/.test(s);

/** Creates and starts a gateway session that will post messages to our webhook, signed with our secret. */
export async function gwCreateSession(name: string, webhookUrl: string) {
  return call("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      name, start: true,
      config: {
        metadata: { app: "unified-box" },
        webhooks: [{ url: webhookUrl, events: ["message.any", "session.status"], hmac: { key: process.env.WA_GATEWAY_WEBHOOK_SECRET }, retries: { policy: "exponential", delaySeconds: 2, attempts: 5 } }],
      },
    }),
  });
}

export async function gwStatus(name: string): Promise<{ status: GatewayStatus; me?: { id: string; pushName?: string } | null }> {
  return call(`/api/sessions/${encodeURIComponent(name)}`);
}

/** QR code to scan in WhatsApp → Linked devices, as a data: URL ready for an <img>. */
export async function gwQr(name: string): Promise<string | null> {
  const r = await call<{ mimetype?: string; data?: string }>(`/api/${encodeURIComponent(name)}/auth/qr?format=image`);
  return r.data ? `data:${r.mimetype ?? "image/png"};base64,${r.data}` : null;
}

/** Alternative to the QR: an 8-character code the person types in WhatsApp → Linked devices → Link with phone number. */
export async function gwPairingCode(name: string, phone: string): Promise<string | null> {
  const r = await call<{ code?: string }>(`/api/${encodeURIComponent(name)}/auth/request-code`, { method: "POST", body: JSON.stringify({ phoneNumber: phone.replace(/\D/g, "") }) });
  return r.code ?? null;
}

export async function gwSendText(name: string, chatId: string, text: string): Promise<{ id: string }> {
  const r = await call<{ id?: string | { _serialized?: string } }>("/api/sendText", { method: "POST", body: JSON.stringify({ session: name, chatId, text, linkPreview: true }) });
  const id = typeof r.id === "string" ? r.id : r.id?._serialized;
  return { id: id ?? `wa-web-out-${Date.now()}` };
}

/** Unlinks the device from the person's phone and deletes the gateway session. Best effort. */
export async function gwLogout(name: string) {
  await call(`/api/sessions/${encodeURIComponent(name)}/logout`, { method: "POST" }).catch(() => null);
  await call(`/api/sessions/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(() => null);
}

/** Verifies the gateway's X-Webhook-Hmac (HMAC-SHA512 of the raw body, hex). */
export function validGatewaySignature(raw: string, header: string | null, secret: string) {
  if (!header || !secret) return false;
  const want = Buffer.from(createHmac("sha512", secret).update(raw).digest("hex"));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

type WaMsg = {
  id: string; timestamp: number; from: string; to: string; fromMe: boolean; body?: string; hasMedia?: boolean; author?: string; participant?: string;
  // engine-specific raw data: WEBJS/NOWEB use notifyName/pushName, GOWS uses Info.PushName and Message.<type>Message
  _data?: { notifyName?: string; pushName?: string; Info?: { PushName?: string }; Message?: Record<string, unknown> }; media?: { mimetype?: string } | null;
};
export type GatewayEvent =
  | { kind: "message"; session: string; chatId: string; chatName: string; isGroup: boolean; msg: GmailMsg }
  | { kind: "status"; session: string; status: GatewayStatus }
  | { kind: "ignore" };

const label = (m: WaMsg) => {
  if (m.body?.trim()) return m.body;
  if (!m.hasMedia) return "";
  const t = m.media?.mimetype ?? "";
  const k = Object.keys(m._data?.Message ?? {}).join(" ");
  if (t.startsWith("image/") || /imageMessage/.test(k)) return "📷 Photo";
  if (t.startsWith("video/") || /videoMessage/.test(k)) return "🎥 Video";
  if (t.startsWith("audio/") || /audioMessage/.test(k)) return "🎤 Voice message";
  if (/stickerMessage/.test(k)) return "Sticker";
  return "📎 Attachment";
};

/** Turns one gateway webhook into something we store. Status broadcasts and channel/newsletter posts are ignored. */
export function parseGatewayEvent(body: unknown): GatewayEvent {
  const b = body as { event?: string; session?: string; payload?: unknown };
  if (!b || !validSessionName(b.session)) return { kind: "ignore" };
  if (b.event === "session.status") return { kind: "status", session: b.session, status: (b.payload as { status: GatewayStatus }).status };
  if (b.event !== "message" && b.event !== "message.any") return { kind: "ignore" };
  const m = b.payload as WaMsg;
  if (!m?.id || !m.from) return { kind: "ignore" };
  const chatId = m.fromMe ? m.to : m.from;
  if (!chatId || /status@broadcast|@newsletter$/.test(chatId)) return { kind: "ignore" };
  const text = label(m);
  if (!text) return { kind: "ignore" };
  const isGroup = chatId.endsWith("@g.us");
  const who = m.participant || m.author || m.from;
  const sender = m._data?.notifyName || m._data?.pushName || m._data?.Info?.PushName || `+${who.split("@")[0]}`;
  const chatName = isGroup ? "WhatsApp group" : m.fromMe ? `+${chatId.split("@")[0]}` : sender;
  const at = new Date((m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000) || Date.now()).toISOString();
  return {
    kind: "message", session: b.session, chatId, chatName, isGroup,
    msg: {
      id: m.id, threadId: chatId, subject: chatName, fromName: m.fromMe ? "You" : sender, fromAddr: m.fromMe ? "me" : who,
      to: [], cc: [], messageId: "", body: text.slice(0, 20_000), sentAt: at, snippet: text.slice(0, 200), unread: !m.fromMe, outgoing: m.fromMe, automated: false,
    },
  };
}

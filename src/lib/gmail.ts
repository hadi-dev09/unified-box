import { env } from "./env";
import { decrypt, encrypt } from "./crypto";
import { supabaseAdmin } from "./supabase/admin";
import { decodeEntities, htmlToText, looksAutomated, parseFrom } from "./mail-text";

export const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export function authUrl(state: string, withSend: boolean) {
  const p = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: `${env("APP_URL")}/api/connect/gmail/callback`,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: ["openid", "email", READ_SCOPE, ...(withSend ? [SEND_SCOPE] : [])].join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type Tokens = { access_token: string; refresh_token: string; expires_at: number; scope: string };

export async function exchangeCode(code: string): Promise<Tokens & { id_token: string }> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: `${env("APP_URL")}/api/connect/gmail/callback`,
      grant_type: "authorization_code",
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) throw new Error(`Google token exchange failed: ${j.error_description ?? j.error ?? "no refresh token"}`);
  return { ...j, expires_at: Date.now() + j.expires_in * 1000 };
}

/** Decode the email from the id_token we just received directly from Google over TLS. */
export function emailFromIdToken(idToken: string): string {
  const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
  if (!payload.email) throw new Error("No email in id_token");
  return payload.email as string;
}

export class NeedsReauth extends Error {}

async function accessToken(accountId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("account_secrets").select("tokens_enc").eq("account_id", accountId).single();
  if (error || !data) throw new Error("No stored tokens");
  const t: Tokens = JSON.parse(decrypt(data.tokens_enc));
  if (t.expires_at - 60_000 > Date.now()) return t.access_token;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: t.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    if (j.error === "invalid_grant") throw new NeedsReauth(j.error_description ?? "invalid_grant");
    throw new Error(`Token refresh failed: ${j.error}`);
  }
  const next: Tokens = { ...t, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
  await db.from("account_secrets").update({ tokens_enc: encrypt(JSON.stringify(next)) }).eq("account_id", accountId);
  return next.access_token;
}

async function gfetch(accountId: string, path: string, init?: RequestInit) {
  const token = await accessToken(accountId);
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (r.status === 401) throw new NeedsReauth("401 from Gmail");
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[]; headers?: { name: string; value: string }[] };

function findPart(p: Part, mime: string): string {
  if (p.mimeType === mime && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
  for (const c of p.parts ?? []) {
    const t = findPart(c, mime);
    if (t) return t;
  }
  return "";
}

/**
 * Prefer text/plain, but fall back to the HTML version when it's missing, or when the HTML has web links the plain
 * version dropped (common for "Confirm" / "Reset password" buttons). HTML is converted to text with [label](url) links.
 */
function bodyText(p: Part): string {
  const plain = findPart(p, "text/plain").trim();
  const html = findPart(p, "text/html");
  if (!html) return plain;
  if (!plain) return htmlToText(html);
  const links = [...html.matchAll(/href\s*=\s*["'](https?:\/\/[^"'\s]+)["']/gi)].map((m) => decodeEntities(m[1]));
  const missing = links.some((u) => !plain.includes(u));
  return missing ? htmlToText(html) : plain;
}

const header = (p: Part, n: string) => p.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";

export type GmailMsg = {
  id: string; threadId: string; subject: string; fromName: string; fromAddr: string;
  to: string[]; cc: string[]; messageId: string; body: string; sentAt: string; snippet: string; unread: boolean; outgoing: boolean; automated: boolean;
};

const addrList = (v: string) => v.split(",").map((s) => parseFrom(s).addr).filter((a) => a.includes("@"));

export async function recentMessages(accountId: string, selfEmail: string, days = 14, max = 50): Promise<GmailMsg[]> {
  const list = await gfetch(accountId, `messages?maxResults=${max}&q=${encodeURIComponent(`newer_than:${days}d -in:spam -in:trash`)}`);
  const out: GmailMsg[] = [];
  for (const { id } of (list.messages ?? []) as { id: string }[]) {
    const m = await gfetch(accountId, `messages/${id}?format=full`);
    const from = parseFrom(header(m.payload, "From"));
    out.push({
      id: m.id,
      threadId: m.threadId,
      subject: header(m.payload, "Subject"),
      fromName: from.name,
      fromAddr: from.addr,
      to: addrList(header(m.payload, "To")),
      cc: addrList(header(m.payload, "Cc")),
      messageId: header(m.payload, "Message-ID").trim(),
      body: bodyText(m.payload).slice(0, 20_000),
      sentAt: new Date(Number(m.internalDate)).toISOString(),
      snippet: decodeEntities(m.snippet ?? ""),
      unread: (m.labelIds ?? []).includes("UNREAD"),
      outgoing: from.addr.toLowerCase() === selfEmail.toLowerCase(),
      automated: looksAutomated({
        labels: m.labelIds ?? [],
        fromAddr: from.addr,
        listUnsubscribe: header(m.payload, "List-Unsubscribe"),
        precedence: header(m.payload, "Precedence"),
        autoSubmitted: header(m.payload, "Auto-Submitted"),
      }),
    });
  }
  return out;
}

export type OutgoingMail = {
  from: string; to: string[]; cc?: string[]; subject: string; body: string;
  threadId?: string; inReplyTo?: string; references?: string[];
};

const MSG_ID = /^<[^<>\s]{1,300}>$/;

/** Sends a plain-text email. Only ever called after a signed-in human approves or writes it. */
export async function sendMail(accountId: string, m: OutgoingMail) {
  const safe = (s: string) => s.replace(/[\r\n]+/g, " "); // block header injection
  const refs = (m.references ?? []).filter((r) => MSG_ID.test(r)).slice(-20);
  const inReplyTo = m.inReplyTo && MSG_ID.test(m.inReplyTo) ? m.inReplyTo : undefined;
  const headers = [
    `From: ${safe(m.from)}`,
    `To: ${m.to.map(safe).join(", ")}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.map(safe).join(", ")}`] : []),
    `Subject: ${safe(m.subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${(refs.length ? refs : [inReplyTo]).join(" ")}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  const raw = [...headers, "", m.body].join("\r\n");
  return gfetch(accountId, "messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url"), ...(m.threadId ? { threadId: m.threadId } : {}) }),
  });
}

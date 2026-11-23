import { env } from "./env";
import { decrypt, encrypt } from "./crypto";
import { supabaseAdmin } from "./supabase/admin";
import { decodeEntities, htmlToText, looksAutomated, parseFrom } from "./mail-text";

export const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
/** Lets read/unread, star and trash made in Unified Box show up in Gmail too (requested with "read + send"). */
export const MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

/** basicOnly: just "who are you" (name, email, photo) for signing in. Google needs no app review for that and shows no warning. */
export function authUrl(state: string, withSend: boolean, basicOnly = false) {
  const p = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: `${env("APP_URL")}/api/connect/gmail/callback`,
    response_type: "code",
    ...(basicOnly ? { prompt: "select_account" } : { access_type: "offline", prompt: "consent", include_granted_scopes: "true" }),
    scope: ["openid", "email", "profile", ...(basicOnly ? [] : [READ_SCOPE, ...(withSend ? [SEND_SCOPE, MODIFY_SCOPE] : [])])].join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type Tokens = { access_token: string; refresh_token: string; expires_at: number; scope: string };

/** needRefresh=false for plain sign-in (name/email only), where Google gives no long-lived token. */
export async function exchangeCode(code: string, needRefresh = true): Promise<Tokens & { id_token: string }> {
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
  if (!r.ok || (needRefresh && !j.refresh_token)) throw new Error(`Google token exchange failed: ${j.error_description ?? j.error ?? "no refresh token"}`);
  return { ...j, expires_at: Date.now() + j.expires_in * 1000 };
}

/** Identity claims from the id_token we just received directly from Google over TLS (token endpoint + client secret). */
export function idTokenClaims(idToken: string): { email: string; emailVerified: boolean; name: string; picture: string | null } {
  const p = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
  if (!p.email) throw new Error("No email in id_token");
  return { email: String(p.email).toLowerCase(), emailVerified: p.email_verified === true || p.email_verified === "true", name: String(p.name ?? ""), picture: typeof p.picture === "string" && p.picture.startsWith("https://") ? p.picture : null };
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
  /** Chat media (photo, video, voice note, file): shown inline, downloaded on demand. */
  attachments?: MsgAttachment[];
};
export type MsgAttachment = { id: string; type: "img" | "video" | "audio" | "file" | "other"; name?: string; mime?: string; voice?: boolean };

const addrList = (v: string) => v.split(",").map((s) => parseFrom(s).addr).filter((a) => a.includes("@"));

/** Message ids (newest first) matching a Gmail search, following pages up to `max`. */
export async function listIds(accountId: string, q: string, max = 100): Promise<{ id: string; threadId: string }[]> {
  const out: { id: string; threadId: string }[] = [];
  let page = "";
  while (out.length < max) {
    const n = Math.min(100, max - out.length);
    const j = await gfetch(accountId, `messages?maxResults=${n}&q=${encodeURIComponent(q)}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
    out.push(...((j.messages ?? []) as { id: string; threadId: string }[]));
    page = j.nextPageToken ?? "";
    if (!page) break;
  }
  return out;
}

/** Downloads and parses one message. */
export async function getMessage(accountId: string, id: string, selfEmail: string): Promise<GmailMsg> {
  const m = await gfetch(accountId, `messages/${id}?format=full`);
  const from = parseFrom(header(m.payload, "From"));
  return {
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
      subject: header(m.payload, "Subject"),
    }),
  };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export const WINDOW_QUERY = "newer_than:14d -in:spam -in:trash";

/** Recent messages, fully parsed (kept for callers that want everything). */
export async function recentMessages(accountId: string, selfEmail: string): Promise<GmailMsg[]> {
  const ids = await listIds(accountId, WINDOW_QUERY, 50);
  return mapLimit(ids, 6, (x) => getMessage(accountId, x.id, selfEmail));
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

/** True when the stored grant for this account includes `scope`. */
export async function gmailHasScope(accountId: string, scope: string) {
  const { data } = await supabaseAdmin().from("account_secrets").select("tokens_enc").eq("account_id", accountId).maybeSingle();
  if (!data) return false;
  try { return String((JSON.parse(decrypt(data.tokens_enc)) as Tokens).scope ?? "").split(" ").includes(scope); } catch { return false; }
}

/** Adds/removes labels on a whole Gmail conversation (UNREAD, STARRED, ...). Needs gmail.modify. */
export async function gmailModifyThread(accountId: string, threadId: string, add: string[], remove: string[]) {
  await gfetch(accountId, `threads/${encodeURIComponent(threadId)}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) });
}
/** Moves a Gmail conversation to Trash (or back). Needs gmail.modify. */
export async function gmailTrashThread(accountId: string, threadId: string, restore = false) {
  await gfetch(accountId, `threads/${encodeURIComponent(threadId)}/${restore ? "untrash" : "trash"}`, { method: "POST" });
}

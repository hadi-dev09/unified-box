import { env } from "./env";
import { decrypt, encrypt } from "./crypto";
import { NeedsReauth, type GmailMsg, type OutgoingMail } from "./gmail";
import { decodeEntities, looksAutomated } from "./mail-text";
import { supabaseAdmin } from "./supabase/admin";

// Microsoft identity platform (works for personal Outlook.com and work/school Microsoft 365 accounts).
const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const READ = ["offline_access", "openid", "email", "profile", "User.Read", "Mail.Read"];
const SEND = "Mail.Send";

export const outlookConfigured = () => Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
const redirect = () => `${env("APP_URL")}/api/connect/outlook/callback`;

export function outlookAuthUrl(state: string, withSend: boolean) {
  return `${AUTH}/authorize?${new URLSearchParams({
    client_id: env("MICROSOFT_CLIENT_ID"), response_type: "code", response_mode: "query", redirect_uri: redirect(),
    scope: [...READ, ...(withSend ? [SEND] : [])].join(" "), state, prompt: "select_account",
  })}`;
}

type Tokens = { access_token: string; refresh_token: string; expires_at: number; scope: string };

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${AUTH}/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("MICROSOFT_CLIENT_ID"), client_secret: env("MICROSOFT_CLIENT_SECRET"), ...body }),
  });
  const j = await r.json();
  if (!r.ok) {
    if (j.error === "invalid_grant" || j.error === "interaction_required") throw new NeedsReauth(j.error_description ?? j.error);
    throw new Error(`Microsoft token error: ${j.error_description ?? j.error}`);
  }
  return { access_token: j.access_token, refresh_token: j.refresh_token ?? body.refresh_token, expires_at: Date.now() + j.expires_in * 1000, scope: j.scope ?? "" };
}

export const outlookExchange = (code: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirect() });

async function accessToken(accountId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data } = await db.from("account_secrets").select("tokens_enc").eq("account_id", accountId).single();
  if (!data) throw new Error("No stored tokens");
  const t: Tokens = JSON.parse(decrypt(data.tokens_enc));
  if (t.expires_at - 60_000 > Date.now()) return t.access_token;
  const next = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token, scope: t.scope || READ.join(" ") });
  await db.from("account_secrets").update({ tokens_enc: encrypt(JSON.stringify(next)) }).eq("account_id", accountId);
  return next.access_token;
}

export async function graph(accountIdOrToken: { accountId?: string; token?: string }, path: string, init?: RequestInit) {
  const token = accountIdOrToken.token ?? (await accessToken(accountIdOrToken.accountId!));
  const r = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", Prefer: 'outlook.body-content-type="text"', ...(init?.headers ?? {}) },
  });
  if (r.status === 401) throw new NeedsReauth("401 from Microsoft Graph");
  if (r.status === 202 || r.status === 204) return {};
  if (!r.ok) throw new Error(`Microsoft Graph ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export async function outlookMe(token: string): Promise<{ email: string; name: string }> {
  const me = await graph({ token }, "/me?$select=mail,userPrincipalName,displayName");
  return { email: String(me.mail || me.userPrincipalName || "").toLowerCase(), name: me.displayName ?? "" };
}

type GraphAddr = { emailAddress?: { address?: string; name?: string } };
type GraphMsg = {
  id: string; conversationId: string; subject?: string; from?: GraphAddr; toRecipients?: GraphAddr[]; ccRecipients?: GraphAddr[];
  receivedDateTime: string; isRead?: boolean; bodyPreview?: string; body?: { content?: string }; internetMessageId?: string;
  inferenceClassification?: string; parentFolderId?: string;
};
const addr = (a?: GraphAddr) => (a?.emailAddress?.address ?? "").trim();

export function toMsg(m: GraphMsg, self: string): GmailMsg {
  const from = addr(m.from);
  const outgoing = from.toLowerCase() === self.toLowerCase();
  return {
    id: m.id, threadId: m.conversationId, subject: m.subject ?? "", fromName: m.from?.emailAddress?.name ?? "", fromAddr: from,
    to: (m.toRecipients ?? []).map(addr).filter(Boolean), cc: (m.ccRecipients ?? []).map(addr).filter(Boolean),
    messageId: m.internetMessageId ?? "", body: (m.body?.content ?? "").trim().slice(0, 20_000),
    sentAt: new Date(m.receivedDateTime).toISOString(), snippet: decodeEntities(m.bodyPreview ?? ""),
    unread: !outgoing && m.isRead === false, outgoing,
    automated: m.inferenceClassification === "other" || looksAutomated({ labels: [], fromAddr: from }),
  };
}

/** Last 14 days of mail across folders, excluding drafts, Junk and Deleted. */
export async function outlookRecent(accountId: string, self: string): Promise<GmailMsg[]> {
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const [junk, trash] = await Promise.all(["junkemail", "deleteditems"].map((f) => graph({ accountId }, `/me/mailFolders/${f}?$select=id`).catch(() => ({ id: "" }))));
  const skip = new Set([junk.id, trash.id].filter(Boolean));
  const q = new URLSearchParams({
    $top: "100", $orderby: "receivedDateTime desc", $filter: `receivedDateTime ge ${since} and isDraft eq false`,
    $select: "id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,bodyPreview,body,internetMessageId,inferenceClassification,parentFolderId",
  });
  const j = await graph({ accountId }, `/me/messages?${q}`);
  return ((j.value ?? []) as GraphMsg[]).filter((m) => !skip.has(m.parentFolderId ?? "")).map((m) => toMsg(m, self));
}

const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));

/** Reply/forward keeps Outlook threading by replying to the latest message; otherwise sends a new email. */
export async function outlookSend(accountId: string, m: OutgoingMail & { replyToId?: string; mode?: string }) {
  if (m.replyToId && m.mode === "forward") {
    return graph({ accountId }, `/me/messages/${encodeURIComponent(m.replyToId)}/forward`, { method: "POST", body: JSON.stringify({ comment: m.body, toRecipients: recipients(m.to) }) });
  }
  if (m.replyToId) {
    return graph({ accountId }, `/me/messages/${encodeURIComponent(m.replyToId)}/reply`, {
      method: "POST", body: JSON.stringify({ message: { toRecipients: recipients(m.to), ccRecipients: recipients(m.cc ?? []) }, comment: m.body }),
    });
  }
  return graph({ accountId }, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({ message: { subject: m.subject, body: { contentType: "Text", content: m.body }, toRecipients: recipients(m.to), ccRecipients: recipients(m.cc ?? []) }, saveToSentItems: true }),
  });
}

export { SEND as OUTLOOK_SEND_SCOPE };

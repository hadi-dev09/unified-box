import { env } from "./env";
import { decrypt } from "./crypto";
import { isRealMessage, mentionedUsers, slackTextToPlain, slackTsToIso } from "./slack-text";
import { supabaseAdmin } from "./supabase/admin";

// Read-only user scopes: the app sees exactly what the signed-in user can see, and can write nothing.
export const SLACK_USER_SCOPES = [
  "channels:history", "channels:read", "groups:history", "groups:read",
  "im:history", "im:read", "mpim:history", "mpim:read", "users:read", "team:read",
];

export const slackConfigured = () => Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);

export function slackAuthUrl(state: string) {
  const p = new URLSearchParams({
    client_id: env("SLACK_CLIENT_ID"),
    user_scope: SLACK_USER_SCOPES.join(","),
    redirect_uri: `${env("APP_URL")}/api/connect/slack/callback`,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${p}`;
}

type OAuthResult = { ok: boolean; error?: string; team?: { id: string; name: string }; authed_user?: { id: string; access_token?: string; scope?: string } };

export async function slackExchange(code: string): Promise<{ teamId: string; teamName: string; userId: string; token: string; scope: string }> {
  const r = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env("SLACK_CLIENT_ID"), client_secret: env("SLACK_CLIENT_SECRET"),
      redirect_uri: `${env("APP_URL")}/api/connect/slack/callback`,
    }),
  });
  const j = (await r.json()) as OAuthResult;
  if (!j.ok || !j.team || !j.authed_user?.access_token) throw new Error(`Slack token exchange failed: ${j.error ?? "no user token"}`);
  return { teamId: j.team.id, teamName: j.team.name, userId: j.authed_user.id, token: j.authed_user.access_token, scope: j.authed_user.scope ?? "" };
}

export class SlackNeedsReauth extends Error {}
export class SlackRateLimited extends Error { constructor(public retryAfterS: number) { super(`Slack rate limit, retry in ${retryAfterS}s`); } }

const REAUTH = new Set(["token_revoked", "invalid_auth", "not_authed", "account_inactive", "token_expired", "org_login_required"]);

async function call<T = Record<string, unknown>>(token: string, method: string, params: Record<string, string>): Promise<T & { ok: boolean }> {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${token}` } });
  if (r.status === 429) throw new SlackRateLimited(Number(r.headers.get("retry-after") ?? 60));
  if (!r.ok) throw new Error(`Slack HTTP ${r.status} on ${method}`);
  const j = (await r.json()) as T & { ok: boolean; error?: string };
  if (!j.ok) {
    if (j.error === "ratelimited") throw new SlackRateLimited(60);
    if (REAUTH.has(j.error ?? "")) throw new SlackNeedsReauth(j.error);
    throw new Error(`Slack ${method}: ${j.error}`);
  }
  return j;
}

export async function slackRevoke(token: string) {
  await fetch("https://slack.com/api/auth.revoke", { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

type Conv = { id: string; name?: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean; user?: string };
type Msg = { ts?: string; user?: string; bot_id?: string; username?: string; text?: string; subtype?: string; thread_ts?: string };

const MAX_CONVS_PER_SYNC = 20;
const HISTORY_DAYS = 14;

/**
 * Reads recent messages from the user's Slack conversations. Slack throttles history calls hard for some apps,
 * so each run covers a rotating window of conversations (cursor kept on the account) and stops cleanly on 429.
 */
export async function syncSlack(accountId: string) {
  const db = supabaseAdmin();
  const { data: acct } = await db.from("accounts").select("*").eq("id", accountId).single();
  if (!acct || acct.provider !== "slack") return { accountId, synced: 0 };
  const [, selfId] = String(acct.external_id).split(":");
  let rateNote: string | null = null;

  try {
    const { data: sec } = await db.from("account_secrets").select("tokens_enc").eq("account_id", accountId).single();
    if (!sec) throw new Error("No stored tokens");
    const token = (JSON.parse(decrypt(sec.tokens_enc)) as { access_token: string }).access_token;

    // 1. conversations the user is in
    const convs: Conv[] = [];
    let cursor = "";
    for (let page = 0; page < 5; page++) {
      const j = await call<{ channels: Conv[]; response_metadata?: { next_cursor?: string } }>(token, "users.conversations", {
        types: "public_channel,private_channel,mpim,im", exclude_archived: "true", limit: "200", ...(cursor ? { cursor } : {}),
      });
      convs.push(...j.channels);
      cursor = j.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
    convs.sort((a, b) => a.id.localeCompare(b.id));

    // 2. rotating window so large workspaces are covered across syncs
    const start = convs.length ? Number(acct.sync_cursor ?? 0) % convs.length : 0;
    const window = convs.length <= MAX_CONVS_PER_SYNC ? convs : [...convs.slice(start), ...convs.slice(0, start)].slice(0, MAX_CONVS_PER_SYNC);

    const names: Record<string, string> = {};
    const userName = async (id: string) => {
      if (names[id]) return names[id];
      try {
        const u = await call<{ user: { real_name?: string; name?: string; profile?: { display_name?: string } } }>(token, "users.info", { user: id });
        names[id] = u.user.profile?.display_name || u.user.real_name || u.user.name || id;
      } catch (e) {
        if (e instanceof SlackNeedsReauth || e instanceof SlackRateLimited) throw e;
        names[id] = id;
      }
      return names[id];
    };

    const oldest = String(Math.floor(Date.now() / 1000) - HISTORY_DAYS * 86400);
    let synced = 0, done = 0;

    for (const c of window) {
      let msgs: Msg[];
      try {
        msgs = (await call<{ messages: Msg[] }>(token, "conversations.history", { channel: c.id, oldest, limit: "30" })).messages.filter(isRealMessage);
      } catch (e) {
        if (e instanceof SlackRateLimited) { rateNote = `Slack rate limit reached after ${done} of ${window.length} conversations; the rest sync next time.`; break; }
        if (e instanceof Error && /not_in_channel|channel_not_found|missing_scope/.test(e.message)) { done++; continue; }
        throw e;
      }
      done++;
      if (!msgs.length) continue;
      msgs.sort((a, b) => parseFloat(a.ts!) - parseFloat(b.ts!));

      const ids = new Set<string>();
      for (const m of msgs) { if (m.user) ids.add(m.user); mentionedUsers(m.text ?? "").forEach((x) => ids.add(x)); }
      if (c.is_im && c.user) ids.add(c.user);
      for (const id of ids) await userName(id);

      const last = msgs[msgs.length - 1];
      const lastMine = last.user === selfId;
      const title = c.is_im ? `DM · ${names[c.user ?? ""] ?? "unknown"}` : c.is_mpim ? `Group DM · ${(c.name ?? "").replace(/^mpdm-|-\d+$/g, "").split("--").join(", ")}` : `${c.is_private ? "🔒" : "#"}${c.name ?? c.id}`;
      const lastText = slackTextToPlain(last.text ?? "", names);

      const { data: t, error } = await db.from("threads").upsert({
        user_id: acct.user_id, account_id: accountId, external_id: c.id, subject: title, snippet: lastText.slice(0, 200),
        last_message_at: slackTsToIso(last.ts!), unread: false,
        needs_reply: Boolean((c.is_im || c.is_mpim) && !lastMine),
        last_from: lastMine ? "You" : (last.user ? names[last.user] : last.username) ?? "Slack",
      }, { onConflict: "account_id,external_id" }).select("id").single();
      if (error || !t) throw new Error(error?.message ?? "thread upsert failed");

      const { error: e2 } = await db.from("messages").upsert(msgs.map((m) => ({
        user_id: acct.user_id, account_id: accountId, thread_id: t.id, external_id: `${c.id}:${m.ts}`,
        from_addr: m.user ?? m.bot_id ?? "", from_name: m.user ? names[m.user] : m.username ?? "Bot",
        to_addrs: [], subject: title, body_text: slackTextToPlain(m.text ?? "", names).slice(0, 20_000),
        sent_at: slackTsToIso(m.ts!), is_outgoing: m.user === selfId,
      })), { onConflict: "account_id,external_id" });
      if (e2) throw new Error(e2.message);
      synced += msgs.length;
    }

    await db.from("accounts").update({
      status: "connected", status_detail: rateNote, last_synced_at: new Date().toISOString(),
      sync_cursor: String(convs.length ? (start + done) % convs.length : 0),
    }).eq("id", accountId);
    return { accountId, synced, ...(rateNote ? { note: rateNote } : {}) };
  } catch (e) {
    const reauth = e instanceof SlackNeedsReauth;
    await db.from("accounts").update({ status: reauth ? "needs_reauth" : "error", status_detail: String((e as Error).message).slice(0, 300) }).eq("id", accountId);
    return { accountId, synced: 0, error: (e as Error).message };
  }
}


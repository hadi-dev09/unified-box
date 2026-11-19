import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { decrypt } from "./crypto";
import { isRealMessage, mentionedUsers, slackTextToPlain, slackTsToIso } from "./slack-text";
import { supabaseAdmin } from "./supabase/admin";

// User scopes: the app sees exactly what the signed-in user can see. Posting (chat:write) is only requested when the user opts in.
export const SLACK_USER_SCOPES = [
  "channels:history", "channels:read", "groups:history", "groups:read",
  "im:history", "im:read", "mpim:history", "mpim:read", "users:read", "team:read",
];

export const SLACK_SEND_SCOPE = "chat:write";
/** Needed only to move your read position (conversations.mark), so read/unread here shows in Slack too. */
export const SLACK_MARK_SCOPES = ["channels:write", "groups:write", "im:write", "mpim:write"];
export const slackConfigured = () => Boolean(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);

export function slackAuthUrl(state: string, withSend = false) {
  const p = new URLSearchParams({
    client_id: env("SLACK_CLIENT_ID"),
    user_scope: [...SLACK_USER_SCOPES, ...(withSend ? [SLACK_SEND_SCOPE, ...SLACK_MARK_SCOPES] : [])].join(","),
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

/** Posts a message into a conversation as the signed-in user (only after they asked for it in the app). Returns the message ts. */
export async function slackSend(accountId: string, channel: string, text: string, threadTs?: string | null): Promise<{ ts: string }> {
  const { data: sec } = await supabaseAdmin().from("account_secrets").select("tokens_enc").eq("account_id", accountId).single();
  if (!sec) throw new Error("No stored tokens");
  const token = (JSON.parse(decrypt(sec.tokens_enc)) as { access_token: string }).access_token;
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, text, unfurl_links: true, ...(threadTs ? { thread_ts: threadTs } : {}) }),
  });
  if (r.status === 429) throw new Error("Slack is rate limiting messages. Try again in a minute.");
  const j = (await r.json()) as { ok: boolean; error?: string; ts?: string };
  if (!j.ok || !j.ts) {
    const e = j.error ?? `HTTP ${r.status}`;
    if (REAUTH.has(e)) throw new SlackNeedsReauth(e);
    if (e === "missing_scope" || e === "no_permission") throw new Error("This Slack connection can't post yet. Reconnect Slack with replies enabled.");
    if (e === "not_in_channel" || e === "channel_not_found") throw new Error("You can't post in this Slack conversation.");
    if (e === "is_archived") throw new Error("This Slack channel is archived.");
    if (e === "restricted_action" || e === "action_prohibited") throw new Error("Your Slack workspace doesn't allow you to post here.");
    throw new Error(`Slack couldn't send the message (${e}).`);
  }
  return { ts: j.ts };
}

export async function slackRevoke(token: string) {
  await fetch("https://slack.com/api/auth.revoke", { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

type Conv = { id: string; name?: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean; user?: string };
type Msg = { ts?: string; user?: string; bot_id?: string; username?: string; text?: string; subtype?: string; thread_ts?: string; reply_count?: number; latest_reply?: string };

/** Every Slack thread is its own conversation here (like Slack's Threads view): external_id "<channel>/<thread ts>". */
export const slackThreadKey = (channel: string, threadTs: string) => `${channel}/${threadTs}`;
export function splitSlackExt(ext: string): { channel: string; threadTs: string | null } {
  const [channel, threadTs] = String(ext).split("/");
  return { channel, threadTs: threadTs || null };
}
export const slackThreadTitle = (channelTitle: string) => `Thread in ${channelTitle.replace(/^Thread in /, "")}`;
const isReply = (m: { ts?: string; thread_ts?: string; subtype?: string }) => Boolean(m.thread_ts && m.thread_ts !== m.ts && m.subtype !== "thread_broadcast");

type Db = ReturnType<typeof supabaseAdmin>;
/** Threads count as "yours" (and get their own conversation) in DMs, when you started or replied in them, or when you're mentioned. */
async function threadIsMine(db: Db, accountId: string, channel: string, threadTs: string, direct: boolean, selfId: string, msgs: { user?: string; text?: string }[]) {
  if (direct || msgs.some((m) => m.user === selfId || (m.text ?? "").includes(`<@${selfId}>`))) return true;
  const { data: item } = await db.from("threads").select("id").eq("account_id", accountId).eq("external_id", slackThreadKey(channel, threadTs)).maybeSingle();
  if (item) return true;
  const { data: parent } = await db.from("messages").select("is_outgoing").eq("account_id", accountId).eq("external_id", `${channel}:${threadTs}`).maybeSingle();
  return Boolean(parent?.is_outgoing);
}

/**
 * Stores thread replies in the thread's own conversation. `lastRead` (from Slack, when known) decides unread;
 * otherwise a new reply from someone else makes it unread.
 */
async function storeThreadReplies(db: Db, acct: { id: string; user_id: string }, channel: string, threadTs: string, channelTitle: string, selfId: string,
  replies: Msg[], names: Record<string, string>, lastRead?: string, following = true) {
  if (!replies.length) return null;
  replies.sort((a, b) => parseFloat(a.ts!) - parseFloat(b.ts!));
  const key = slackThreadKey(channel, threadTs);
  const { data: prev } = await db.from("threads").select("id, last_message_at, unread").eq("account_id", acct.id).eq("external_id", key).maybeSingle();
  const last = replies[replies.length - 1];
  const lastAt = slackTsToIso(last.ts!);
  const isNewer = !prev || new Date(lastAt).getTime() > new Date(prev.last_message_at).getTime();
  const lastMine = last.user === selfId;
  const newestIn = [...replies].reverse().find((m) => m.user !== selfId);
  // Threads you don't follow (someone else's thread in a channel) never show as unread, same as Slack.
  const unread = !following ? Boolean(prev?.unread) && !lastMine
    : lastRead !== undefined ? Boolean(newestIn && parseFloat(newestIn.ts!) > parseFloat(lastRead))
    : isNewer ? !lastMine : Boolean(prev?.unread);
  const title = slackThreadTitle(channelTitle);
  const { data: t, error } = await db.from("threads").upsert({
    user_id: acct.user_id, account_id: acct.id, external_id: key, subject: title, unread,
    ...(isNewer ? {
      snippet: slackTextToPlain(last.text ?? "", names).slice(0, 200), last_message_at: lastAt,
      needs_reply: following && !lastMine, last_from: lastMine ? "You" : (last.user ? names[last.user] : last.username) ?? "Slack",
    } : {}),
    ...(unread ? {} : { seen_at: new Date().toISOString() }),
  }, { onConflict: "account_id,external_id" }).select("id").single();
  if (error || !t) throw new Error(error?.message ?? "thread upsert failed");
  const { error: e2 } = await db.from("messages").upsert(replies.map((m) => ({
    user_id: acct.user_id, account_id: acct.id, thread_id: t.id, external_id: `${channel}:${m.ts}`,
    from_addr: m.user ?? m.bot_id ?? "", from_name: m.user ? names[m.user] : m.username ?? "Bot",
    to_addrs: [], subject: title, body_text: slackTextToPlain(m.text ?? "", names).slice(0, 20_000),
    sent_at: slackTsToIso(m.ts!), is_outgoing: m.user === selfId, thread_ts: threadTs,
  })), { onConflict: "account_id,external_id" });
  if (e2) throw new Error(e2.message);
  return t.id as string;
}

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
    let synced = 0, done = 0, repliesBudget = 3;

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
        last_message_at: slackTsToIso(last.ts!),
        needs_reply: Boolean((c.is_im || c.is_mpim) && !lastMine),
        last_from: lastMine ? "You" : (last.user ? names[last.user] : last.username) ?? "Slack",
      }, { onConflict: "account_id,external_id" }).select("id").single();
      if (error || !t) throw new Error(error?.message ?? "thread upsert failed");

      const { error: e2 } = await db.from("messages").upsert(msgs.map((m) => ({
        user_id: acct.user_id, account_id: accountId, thread_id: t.id, external_id: `${c.id}:${m.ts}`,
        from_addr: m.user ?? m.bot_id ?? "", from_name: m.user ? names[m.user] : m.username ?? "Bot",
        to_addrs: [], subject: title, body_text: slackTextToPlain(m.text ?? "", names).slice(0, 20_000),
        sent_at: slackTsToIso(m.ts!), is_outgoing: m.user === selfId,
        thread_ts: m.thread_ts && m.thread_ts !== m.ts ? m.thread_ts : null,
      })), { onConflict: "account_id,external_id" });
      if (e2) throw new Error(e2.message);
      synced += msgs.length;

      // Threads with new replies (Slack only lists the parent in history): fetch the replies for threads you're in.
      for (const m of msgs.filter((x) => (x.reply_count ?? 0) > 0 && x.latest_reply).slice(-5)) {
        if (repliesBudget <= 0) break;
        const following = await threadIsMine(db, accountId, c.id, m.ts!, Boolean(c.is_im || c.is_mpim), selfId, [m]);
        const { data: item } = await db.from("threads").select("last_message_at").eq("account_id", accountId).eq("external_id", slackThreadKey(c.id, m.ts!)).maybeSingle();
        if (item && new Date(item.last_message_at).getTime() >= new Date(slackTsToIso(m.latest_reply!)).getTime()) continue;
        repliesBudget--;
        try {
          const r = await call<{ messages: Msg[] }>(token, "conversations.replies", { channel: c.id, ts: m.ts!, limit: "50" });
          const parent = r.messages.find((x) => x.ts === m.ts) as (Msg & { last_read?: string }) | undefined;
          const replies = r.messages.filter((x) => x.ts !== m.ts && isRealMessage(x));
          for (const x of replies) if (x.user) await userName(x.user);
          await storeThreadReplies(db, acct, c.id, m.ts!, title, selfId, replies, names, following ? parent?.last_read : undefined, following);
        } catch (e) {
          if (e instanceof SlackRateLimited) { repliesBudget = 0; continue; }
          if (e instanceof SlackNeedsReauth) throw e;
        }
      }
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


// ---------- real-time Events API ----------

/** Verifies Slack's request signature (v0 HMAC-SHA256 over "v0:timestamp:body"), rejecting replays older than 5 minutes. */
export function validSlackSignature(raw: string, ts: string | null, sig: string | null, secret: string, nowS = Math.floor(Date.now() / 1000)) {
  if (!ts || !sig || !secret || !/^\d+$/.test(ts) || Math.abs(nowS - Number(ts)) > 300) return false;
  const want = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex")}`);
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

type SlackEvent = { type: string; subtype?: string; channel?: string; channel_type?: string; user?: string; bot_id?: string; username?: string; text?: string; ts?: string; thread_ts?: string; message?: { user?: string; text?: string; ts?: string } };

/** Stores one pushed Slack message into the right conversation, immediately (no polling, no rate limit). */
export async function ingestSlackEvent(acct: { id: string; user_id: string; external_id: string }, ev: SlackEvent) {
  if (ev.type !== "message" || !ev.channel || !ev.ts) return false;
  if (ev.subtype && ev.subtype !== "file_share" && ev.subtype !== "thread_broadcast" && ev.subtype !== "bot_message") return false; // edits, deletes, joins
  const db = supabaseAdmin();
  const [, selfId] = acct.external_id.split(":");
  const { data: sec } = await db.from("account_secrets").select("tokens_enc").eq("account_id", acct.id).single();
  if (!sec) return false;
  const token = (JSON.parse(decrypt(sec.tokens_enc)) as { access_token: string }).access_token;
  const names: Record<string, string> = {};
  const nameOf = async (id: string) => {
    if (names[id]) return names[id];
    try {
      const u = await call<{ user: { real_name?: string; name?: string; profile?: { display_name?: string } } }>(token, "users.info", { user: id });
      names[id] = u.user.profile?.display_name || u.user.real_name || u.user.name || id;
    } catch { names[id] = id; }
    return names[id];
  };
  for (const id of new Set([ev.user, ...mentionedUsers(ev.text ?? "")].filter(Boolean) as string[])) await nameOf(id);

  const { data: prev } = await db.from("threads").select("id, subject").eq("account_id", acct.id).eq("external_id", ev.channel).maybeSingle();
  let title = prev?.subject as string | undefined;
  if (!title) {
    try {
      const c = (await call<{ channel: Conv }>(token, "conversations.info", { channel: ev.channel })).channel;
      if (c.is_im && c.user) await nameOf(c.user);
      title = c.is_im ? `DM · ${names[c.user ?? ""] ?? "unknown"}` : c.is_mpim ? `Group DM · ${(c.name ?? "").replace(/^mpdm-|-\d+$/g, "").split("--").join(", ")}` : `${c.is_private ? "🔒" : "#"}${c.name ?? c.id}`;
    } catch { title = ev.channel_type === "im" ? "Direct message" : ev.channel; }
  }
  const mine = ev.user === selfId;
  const text = slackTextToPlain(ev.text ?? "", names) || (ev.subtype === "file_share" ? "📎 File" : "");
  const at = slackTsToIso(ev.ts);
  const direct = ev.channel_type === "im" || ev.channel_type === "mpim";
  // A reply in a thread you're part of goes to that thread's own conversation (the channel itself isn't bumped, like Slack).
  if (isReply(ev)) {
    const following = await threadIsMine(db, acct.id, ev.channel, ev.thread_ts!, direct, selfId, [ev]);
    await storeThreadReplies(db, acct, ev.channel, ev.thread_ts!, title!, selfId, [{ ...ev, text: ev.text || (ev.subtype === "file_share" ? "📎 File" : "") }], names, undefined, following);
    await db.from("accounts").update({ last_synced_at: new Date().toISOString(), status: "connected", status_detail: null }).eq("id", acct.id);
    return true;
  }
  const mentioned = (ev.text ?? "").includes(`<@${selfId}>`);
  const { data: t, error } = await db.from("threads").upsert({
    user_id: acct.user_id, account_id: acct.id, external_id: ev.channel, subject: title, snippet: text.slice(0, 200), last_message_at: at,
    unread: !mine, needs_reply: !mine && (direct || mentioned), last_from: mine ? "You" : (ev.user ? names[ev.user] : ev.username) ?? "Slack",
  }, { onConflict: "account_id,external_id" }).select("id").single();
  if (error || !t) throw new Error(error?.message ?? "thread upsert failed");
  await db.from("messages").upsert({
    user_id: acct.user_id, account_id: acct.id, thread_id: t.id, external_id: `${ev.channel}:${ev.ts}`,
    from_addr: ev.user ?? ev.bot_id ?? "", from_name: ev.user ? names[ev.user] : ev.username ?? "Bot", to_addrs: [], subject: title,
    body_text: text.slice(0, 20_000), sent_at: at, is_outgoing: mine,
    thread_ts: ev.thread_ts && ev.thread_ts !== ev.ts ? ev.thread_ts : null,
  }, { onConflict: "account_id,external_id" });
  await db.from("accounts").update({ last_synced_at: new Date().toISOString(), status: "connected", status_detail: null }).eq("id", acct.id);
  return true;
}

// ---------- read state, both directions ----------

async function slackToken(accountId: string): Promise<{ token: string; scope: string } | null> {
  const { data: sec } = await supabaseAdmin().from("account_secrets").select("tokens_enc").eq("account_id", accountId).maybeSingle();
  if (!sec) return null;
  const t = JSON.parse(decrypt(sec.tokens_enc)) as { access_token: string; scope?: string };
  return { token: t.access_token, scope: t.scope ?? "" };
}

/**
 * Slack → Unified Box: asks Slack where you have read up to in each recent conversation (conversations.info,
 * not limited like message history) and updates unread here. Runs every minute in the background.
 */
export async function syncSlackReadState(accountId: string, maxConvs = 30) {
  const db = supabaseAdmin();
  const tk = await slackToken(accountId);
  if (!tk) return { checked: 0, changed: 0 };
  const { data: threads } = await db.from("threads").select("id, external_id, unread").eq("account_id", accountId).order("last_message_at", { ascending: false }).limit(maxConvs * 2);
  const channels = ((threads ?? []) as ChanRow[]).filter((t) => !t.external_id.includes("/")).slice(0, maxConvs);
  let checked = 0, changed = 0;
  for (const t of channels) {
    const r = await checkChannelRead(db, tk.token, t);
    if (r === "stop") break;
    if (r !== "skip") checked++;
    if (r === "changed") changed++;
  }
  changed += await syncSlackThreadReadState(db, tk.token, accountId);
  return { checked, changed };
}

type ChanRow = { id: string; external_id: string; unread: boolean };

/** Asks Slack where you've read up to in one DM/channel and updates unread here. Your own messages never count as unread. */
async function checkChannelRead(db: Db, token: string, t: ChanRow): Promise<"same" | "changed" | "skip" | "stop"> {
  let lastRead: string | undefined;
  try {
    lastRead = (await call<{ channel: { last_read?: string } }>(token, "conversations.info", { channel: t.external_id })).channel.last_read;
  } catch (e) {
    return e instanceof SlackRateLimited || e instanceof SlackNeedsReauth ? "stop" : "skip";
  }
  if (!lastRead) return "skip";
  // Thread replies have their own read state in Slack; compare only messages in the main conversation.
  const { data: newest } = await db.from("messages").select("external_id").eq("thread_id", t.id).eq("is_outgoing", false).is("thread_ts", null).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  const newestTs = newest ? String(newest.external_id).split(":").pop() ?? "0" : "0";
  const unread = parseFloat(newestTs) > parseFloat(lastRead);
  if (unread === t.unread) return "same";
  await db.from("threads").update({ unread, ...(unread ? {} : { seen_at: new Date().toISOString() }) }).eq("id", t.id);
  return "changed";
}

/**
 * Fast read-state check while the app is open (every few seconds). Slack has no "message was read" event for apps
 * like this (read markers are only pushed over its retired real-time API), so the app asks. conversations.info is
 * a generous Slack limit (~50/min), so each check covers every unread DM/channel (up to 4) plus one other in rotation
 * (to catch "Mark unread" done in Slack). At most one check per account every 4 seconds, whoever triggers it.
 */
export async function quickSlackReadCheck(accountId: string) {
  const db = supabaseAdmin();
  const { data: acct } = await db.from("accounts").select("read_checked_at").eq("id", accountId).maybeSingle();
  if (acct?.read_checked_at && Date.now() - new Date(acct.read_checked_at).getTime() < 4000) return 0;
  await db.from("accounts").update({ read_checked_at: new Date().toISOString() }).eq("id", accountId);
  const tk = await slackToken(accountId);
  if (!tk) return 0;
  const { data } = await db.from("threads").select("id, external_id, unread, remote_checked_at").eq("account_id", accountId).order("last_message_at", { ascending: false }).limit(40);
  const rows = ((data ?? []) as (ChanRow & { remote_checked_at: string | null })[]).filter((t) => !t.external_id.includes("/"));
  const pick = [
    ...rows.filter((t) => t.unread).slice(0, 4),
    ...rows.filter((t) => !t.unread).sort((a, b) => (a.remote_checked_at ?? "").localeCompare(b.remote_checked_at ?? "")).slice(0, 1),
  ];
  const now = new Date().toISOString();
  const results = await Promise.all(pick.map((t) => checkChannelRead(db, tk.token, t)));
  if (pick.length) await db.from("threads").update({ remote_checked_at: now }).in("id", pick.map((t) => t.id));
  return results.filter((r) => r === "changed").length;
}

/**
 * Thread read state, Slack → here. Slack reports where you've read up to in a thread (last_read on the parent) but its
 * history methods allow non-Marketplace apps one call a minute, so each minute checks one unread thread, oldest-checked first.
 */
async function syncSlackThreadReadState(db: Db, token: string, accountId: string) {
  const { data: rows } = await db.from("threads").select("id, external_id, remote_checked_at").eq("account_id", accountId).eq("unread", true).like("external_id", "%/%")
    .order("remote_checked_at", { ascending: true, nullsFirst: true }).limit(1);
  const t = ((rows ?? []) as { id: string; external_id: string }[])[0];
  if (!t) return 0;
  const { channel, threadTs } = splitSlackExt(t.external_id);
  await db.from("threads").update({ remote_checked_at: new Date().toISOString() }).eq("id", t.id);
  let lastRead: string | undefined;
  try {
    const r = await call<{ messages: (Msg & { last_read?: string })[] }>(token, "conversations.replies", { channel, ts: threadTs!, limit: "1" });
    lastRead = r.messages.find((m) => m.ts === threadTs)?.last_read;
  } catch { return 0; }
  if (!lastRead) return 0;
  const { data: newest } = await db.from("messages").select("external_id").eq("thread_id", t.id).eq("is_outgoing", false).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  const newestTs = newest ? String(newest.external_id).split(":").pop() ?? "0" : "0";
  if (parseFloat(newestTs) > parseFloat(lastRead)) return 0;
  await db.from("threads").update({ unread: false, seen_at: new Date().toISOString() }).eq("id", t.id);
  return 1;
}

/**
 * Unified Box → Slack: moves your read position. Read = up to the newest message; unread = just before it
 * (Slack then shows the conversation as unread). Needs the *:write user scopes; returns false if not granted.
 */
export async function slackMark(accountId: string, channel: string, read: boolean): Promise<boolean> {
  const tk = await slackToken(accountId);
  if (!tk) return false;
  const granted = tk.scope.split(",");
  if (!SLACK_MARK_SCOPES.some((s) => granted.includes(s))) return false;
  const db = supabaseAdmin();
  if (channel.includes("/")) return false; // Slack has no public API for a thread's read state
  const { data: rows } = await db.from("messages").select("external_id, is_outgoing").eq("account_id", accountId).like("external_id", `${channel}:%`).is("thread_ts", null).order("sent_at", { ascending: false }).limit(20);
  const list = (rows ?? []) as { external_id: string; is_outgoing: boolean }[];
  if (!list.length) return false;
  const tsOf = (r: { external_id: string }) => r.external_id.split(":").pop()!;
  // Unread: back up to just before the newest message from someone else (Slack never shows your own messages as unread).
  const incoming = list.find((r) => !r.is_outgoing) ?? list[0];
  const target = read ? tsOf(list[0]) : (parseFloat(tsOf(incoming)) - 0.000001).toFixed(6);
  const r = await fetch("https://slack.com/api/conversations.mark", {
    method: "POST", headers: { authorization: `Bearer ${tk.token}`, "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel, ts: target }),
  });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean };
  return Boolean(j.ok);
}

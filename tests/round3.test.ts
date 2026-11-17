import { A, B, db, stubFetch } from "./setup";
import { createHash, createHmac } from "node:crypto";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as threadsRoute from "../src/app/api/threads/route";
import * as searchRoute from "../src/app/api/search/route";
import * as slackHook from "../src/app/api/webhooks/slack/route";
import * as googleStart from "../src/app/api/auth/google/route";
import * as gmailCallback from "../src/app/api/connect/gmail/callback/route";
import { encrypt } from "../src/lib/crypto";
import { backgroundSync, validCronKey } from "../src/lib/cron";
import { ingestSlackEvent, validSlackSignature } from "../src/lib/slack";
import { tools } from "../src/lib/mcp-tools";
import { MODIFY_SCOPE } from "../src/lib/gmail";

process.env.SLACK_SIGNING_SECRET = "slack-signing";
beforeEach(() => db.reset());

const json = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
function gmailAcct(user = A, scope = "x") {
  const id = `acct-${Math.random().toString(36).slice(2)}`;
  db.rows("accounts").push({ id, user_id: user.id, provider: "gmail", display_name: user.email, external_id: user.email, status: "connected", can_send: true });
  db.rows("account_secrets").push({ account_id: id, tokens_enc: encrypt(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600_000, scope })) });
  return id;
}
function thread(accountId: string, user = A, over: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  db.rows("threads").push({ id, user_id: user.id, account_id: accountId, external_id: `g-${id.slice(0, 6)}`, subject: "Invoice", snippet: "please pay", last_from: "Jo", unread: true, needs_reply: true, last_message_at: new Date().toISOString(), starred: false, snoozed_until: null, trashed_at: null, ...over });
  return id;
}
const act = (ids: string[], action: string, until?: string) => threadsRoute.POST(json("https://app.test/api/threads", { ids, action, until }));

test("thread actions: read/unread/star/snooze/trash in the app; own threads only; validation", async () => {
  const a = gmailAcct(), t1 = thread(a), t2 = thread(a), theirs = thread(gmailAcct(B), B);
  db.user = null;
  assert.equal((await act([t1], "read")).status, 401);
  db.user = A;
  const net = stubFetch(() => undefined); // read-only Gmail grant: must not call Gmail at all
  try {
    const r = await act([t1, t2, theirs], "read");
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.count, 2, "other users' threads are untouched");
    assert.match(j.note, /reconnect Gmail/i);
    assert.equal(db.rows("threads").find((x) => x.id === theirs)!.unread, true);
    assert.equal(net.calls.length, 0);
    await act([t1], "star");
    assert.equal(db.rows("threads").find((x) => x.id === t1)!.starred, true);
    assert.equal((await act([t1], "snooze", new Date(Date.now() - 1000).toISOString())).status, 400, "snooze must be in the future");
    assert.equal((await act([t1], "snooze", new Date(Date.now() + 3600_000).toISOString())).status, 200);
    assert.ok(db.rows("threads").find((x) => x.id === t1)!.snoozed_until);
    await act([t2], "trash");
    assert.ok(db.rows("threads").find((x) => x.id === t2)!.trashed_at);
    await act([t2], "restore");
    assert.equal(db.rows("threads").find((x) => x.id === t2)!.trashed_at, null);
    assert.equal((await act([t1], "explode")).status, 400);
    assert.equal((await act([], "read")).status, 400);
  } finally { net.restore(); }
});

test("thread actions: mirrored to Gmail when the account granted manage access", async () => {
  const a = gmailAcct(A, `x ${MODIFY_SCOPE}`), t = thread(a);
  db.user = A;
  const net = stubFetch((c) => (c.url.includes("/threads/") ? {} : undefined));
  try {
    await act([t], "read");
    await act([t], "star");
    await act([t], "trash");
    const urls = net.calls.map((c) => `${c.url.split("/threads/")[1]} ${c.body}`);
    assert.ok(urls.some((u) => u.includes("/modify") && u.includes('"removeLabelIds":["UNREAD"]')), urls.join("\n"));
    assert.ok(urls.some((u) => u.includes('"addLabelIds":["STARRED"]')));
    assert.ok(urls.some((u) => u.endsWith("/trash ")));
  } finally { net.restore(); }
});

test("background sync wakes snoozed conversations as unread; cron key is checked against a stored hash", async () => {
  const a = gmailAcct(), t = thread(a, A, { unread: false, snoozed_until: new Date(Date.now() - 1000).toISOString() });
  db.rows("accounts")[0].last_synced_at = new Date().toISOString(); // not due, so no network
  await backgroundSync();
  const row = db.rows("threads").find((x) => x.id === t)!;
  assert.equal(row.snoozed_until, null); assert.equal(row.unread, true);
  const key = "k".repeat(64);
  assert.equal(await validCronKey(key), false, "no key configured -> refuse");
  db.rows("internal_config").push({ name: "cron_key_sha256", value: createHash("sha256").update(key).digest("hex") });
  assert.equal(await validCronKey(key), true);
  assert.equal(await validCronKey("k".repeat(63) + "x"), false);
  assert.equal(await validCronKey(null), false);
});

test("search: quick results come from subject or body, only the user's own, max 4", async () => {
  const a = gmailAcct();
  for (let i = 0; i < 6; i++) thread(a, A, { subject: `Invoice ${i}` });
  const t = thread(a, A, { subject: "Hello" });
  db.rows("messages").push({ id: "m1", user_id: A.id, account_id: a, thread_id: t, external_id: "x", body_text: "the quarterly invoice is attached", sent_at: new Date().toISOString() });
  thread(gmailAcct(B), B, { subject: "Invoice secret" });
  db.user = A;
  const r = await (await searchRoute.GET(new NextRequest("https://app.test/api/search?q=invoice"))).json();
  assert.equal(r.results.length, 4);
  assert.equal(r.total, 7, "6 subjects + 1 body match, none of B's");
  db.user = null;
  assert.equal((await searchRoute.GET(new NextRequest("https://app.test/api/search?q=invoice"))).status, 401);
});

test("slack events: signature + replay checks; message is stored for the authorized user only, unread", async () => {
  db.rows("accounts").push({ id: "s1", user_id: A.id, provider: "slack", display_name: "WS", external_id: "T1:U1", status: "connected" });
  db.rows("account_secrets").push({ account_id: "s1", tokens_enc: encrypt(JSON.stringify({ access_token: "xoxp" })) });
  db.rows("accounts").push({ id: "s2", user_id: B.id, provider: "slack", display_name: "WS", external_id: "T1:U9", status: "connected" });
  const now = Math.floor(Date.now() / 1000);
  assert.equal(validSlackSignature("{}", String(now - 400), "v0=x", "s"), false, "old timestamp rejected");
  const body = JSON.stringify({ type: "event_callback", team_id: "T1", authorizations: [{ team_id: "T1", user_id: "U1" }], event: { type: "message", channel: "D1", channel_type: "im", user: "U2", text: "hey <@U1> are you there?", ts: `${now}.0001` } });
  const sig = `v0=${createHmac("sha256", "slack-signing").update(`v0:${now}:${body}`).digest("hex")}`;
  const bad = await slackHook.POST(new NextRequest("https://app.test/api/webhooks/slack", { method: "POST", body, headers: { "x-slack-request-timestamp": String(now), "x-slack-signature": "v0=nope" } }));
  assert.equal(bad.status, 401);
  const challengeBody = JSON.stringify({ type: "url_verification", challenge: "abc" });
  const csig = `v0=${createHmac("sha256", "slack-signing").update(`v0:${now}:${challengeBody}`).digest("hex")}`;
  const ch = await slackHook.POST(new NextRequest("https://app.test/api/webhooks/slack", { method: "POST", body: challengeBody, headers: { "x-slack-request-timestamp": String(now), "x-slack-signature": csig } }));
  assert.equal((await ch.json()).challenge, "abc");
  assert.ok(validSlackSignature(body, String(now), sig, "slack-signing"));
  // ingest directly (the route hands off to after())
  const net = stubFetch((c) => c.url.includes("users.info") ? { ok: true, user: { real_name: "Dana", profile: {} } } : c.url.includes("conversations.info") ? { ok: true, channel: { id: "D1", is_im: true, user: "U2" } } : undefined);
  try {
    assert.equal(await ingestSlackEvent({ id: "s1", user_id: A.id, external_id: "T1:U1" }, JSON.parse(body).event), true);
  } finally { net.restore(); }
  const t = db.rows("threads").find((x) => x.account_id === "s1")!;
  assert.equal(t.subject, "DM · Dana"); assert.equal(t.unread, true); assert.equal(t.needs_reply, true);
  assert.match(String(db.rows("messages")[0].body_text), /@\w+ are you there/);
  assert.equal(db.rows("threads").filter((x) => x.account_id === "s2").length, 0);
});

test("Continue with Google: new user is created, signed in and their Gmail connected in one step", async () => {
  db.user = null;
  const start = await googleStart.GET(new NextRequest("https://app.test/api/auth/google?next=/settings"));
  const loc = new URL(start.headers.get("location")!);
  assert.equal(loc.hostname, "accounts.google.com");
  assert.match(loc.searchParams.get("scope")!, /gmail\.modify/);
  const cookie = start.headers.getSetCookie()[0].split(";")[0];
  const state = loc.searchParams.get("state")!;
  const idToken = `x.${Buffer.from(JSON.stringify({ email: "New@Example.com", email_verified: true, name: "New Person" })).toString("base64url")}.y`;
  const net = stubFetch((c) => c.url === "https://oauth2.googleapis.com/token" ? { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: `openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send ${MODIFY_SCOPE}`, id_token: idToken } : c.url.includes("/messages?") ? { messages: [] } : undefined);
  try {
    const forged = await gmailCallback.GET(new NextRequest(`https://app.test/api/connect/gmail/callback?code=c&state=bad`, { headers: { cookie } }));
    assert.match(decodeURIComponent(forged.headers.get("location")!), /\/login\?error=Sign-in expired/);
    const r = await gmailCallback.GET(new NextRequest(`https://app.test/api/connect/gmail/callback?code=c&state=${state}`, { headers: { cookie } }));
    assert.equal(r.headers.get("location"), "https://app.test/settings");
    assert.equal(db.user?.email, "new@example.com", "signed in");
    const acct = db.rows("accounts")[0];
    assert.equal(acct.user_id, db.user!.id); assert.equal(acct.provider, "gmail"); assert.equal(acct.can_send, true);
  } finally { net.restore(); }
  // unverified Google email is refused
  const s2 = await googleStart.GET(new NextRequest("https://app.test/api/auth/google"));
  const st2 = new URL(s2.headers.get("location")!).searchParams.get("state")!;
  const bad = `x.${Buffer.from(JSON.stringify({ email: "x@y.com", email_verified: false })).toString("base64url")}.y`;
  const net2 = stubFetch(() => ({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "", id_token: bad }));
  try {
    const r = await gmailCallback.GET(new NextRequest(`https://app.test/api/connect/gmail/callback?code=c&state=${st2}`, { headers: { cookie: s2.headers.getSetCookie()[0].split(";")[0] } }));
    assert.match(decodeURIComponent(r.headers.get("location")!), /isn't verified/);
  } finally { net2.restore(); }
});

test("MCP organise tools: AI can group, tag, mark and rename, but only the user's own data", async () => {
  const run = (name: string, uid: string, args: unknown) => tools.find((t) => t.name === name)!.run(uid, args as never) as Promise<Record<string, unknown>>;
  const a = gmailAcct(), t = thread(a);
  const c = await run("create_client_group", A.id, { name: "Acme", domains: ["acme.com"], emails: ["boss@acme.io"] });
  assert.equal((c.client as { name: string }).name, "Acme");
  assert.equal((c.rules_added as string[]).length, 2);
  const list = (await run("list_clients", A.id, {})) as unknown as { name: string; rules: string[] }[];
  assert.equal(list[0].rules.length, 2);
  assert.equal(((await run("list_clients", B.id, {})) as unknown as unknown[]).length, 0);
  const net = stubFetch(() => undefined);
  try {
    const u = await run("update_conversations", A.id, { thread_ids: [t], action: "star" });
    assert.equal(u.updated, 1);
    const other = await run("update_conversations", B.id, { thread_ids: [t], action: "unread" });
    assert.equal(other.updated, 0, "B can't touch A's thread");
  } finally { net.restore(); }
  assert.equal((await run("rename_inbox", A.id, { account_id: a, name: "Work Gmail" })).ok, true);
  assert.equal(db.rows("accounts")[0].label, "Work Gmail");
  assert.match(String((await run("rename_inbox", B.id, { account_id: a, name: "x" })).error), /not found/);
  assert.match(String((await run("connect_channel_link", A.id, { channel: "slack" })).url), /\/api\/connect\/slack\?write=1$/);
  assert.equal(db.rows("audit_log").filter((l) => l.actor === "claude").length >= 2, true);
});

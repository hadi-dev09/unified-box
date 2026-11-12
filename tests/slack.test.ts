import { A, B, db, stubFetch } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as connect from "../src/app/api/connect/slack/route";
import * as callback from "../src/app/api/connect/slack/callback/route";
import { decrypt, encrypt } from "../src/lib/crypto";
import { disconnectAccount } from "../src/lib/accounts";
import { syncAccount } from "../src/lib/sync";

process.env.SLACK_CLIENT_ID = "slack-id";
process.env.SLACK_CLIENT_SECRET = "slack-secret";

beforeEach(() => db.reset());
const loc = (r: Response) => decodeURIComponent(r.headers.get("location") ?? "");
const cb = (qs: string, cookie?: object) => callback.GET(new NextRequest(`https://app.test/api/connect/slack/callback?${qs}`, { headers: cookie ? { cookie: `slack_oauth=${encodeURIComponent(JSON.stringify(cookie))}` } : {} }));

test("connect: requires login and asks only for read-only user scopes", async () => {
  db.user = null;
  assert.match(loc(await connect.GET()), /\/login$/);
  db.user = A;
  const r = await connect.GET();
  const u = new URL(r.headers.get("location")!);
  assert.equal(u.host, "slack.com");
  assert.equal(u.searchParams.get("redirect_uri"), "https://app.test/api/connect/slack/callback");
  assert.equal(u.searchParams.get("scope"), null, "no bot scopes");
  const scopes = u.searchParams.get("user_scope")!.split(",");
  assert.ok(scopes.includes("im:history"));
  assert.ok(!scopes.some((s) => /write|chat:|admin/.test(s)), `read-only only: ${scopes}`);
  assert.match(r.headers.get("set-cookie")!, /HttpOnly/i);
});

test("callback: state/user checks and admin-blocked explanation", async () => {
  db.user = A;
  assert.match(loc(await cb("code=x&state=n")), /expired/i);
  assert.match(loc(await cb("code=x&state=bad", { nonce: "n", uid: A.id })), /Invalid connection/);
  assert.match(loc(await cb("code=x&state=n", { nonce: "n", uid: B.id })), /Invalid connection/);
  assert.match(loc(await cb("error=access_denied&state=n", { nonce: "n", uid: A.id })), /admin may need to approve/i);
  assert.equal(db.rows("accounts").length, 0);
});

const CONVS = {
  ok: true,
  channels: [
    { id: "C1", name: "general", is_channel: true },
    { id: "D1", is_im: true, user: "U2" },
    { id: "C2", name: "secret", is_private: true },
  ],
};
const slackApi = (extra: Record<string, (p: URLSearchParams, c: { url: string }) => unknown> = {}) => (c: { url: string; method: string; body: string }) => {
  const u = new URL(c.url);
  if (u.host !== "slack.com") return undefined;
  const m = u.pathname.replace("/api/", "");
  if (extra[m]) return extra[m](u.searchParams, c);
  if (m === "oauth.v2.access") return { ok: true, team: { id: "T1", name: "Greenbridge" }, authed_user: { id: "U1", access_token: "xoxp-SECRET", scope: "im:history" } };
  if (m === "users.conversations") return CONVS;
  if (m === "users.info") { const id = u.searchParams.get("user")!; return { ok: true, user: { real_name: id === "U1" ? "Me" : id === "U2" ? "Dana Client" : id, profile: { display_name: "" } } }; }
  if (m === "conversations.history") {
    const ch = u.searchParams.get("channel");
    if (ch === "C1") return { ok: true, messages: [{ ts: "1700000200.0001", user: "U2", text: "Deploy done <@U1> &amp; <https://x.io|link>" }, { ts: "1700000100.0001", subtype: "channel_join", user: "U2", text: "joined" }] };
    if (ch === "D1") return { ok: true, messages: [{ ts: "1700000300.0001", user: "U2", text: "Can you review the contract?" }, { ts: "1700000250.0001", user: "U1", text: "Sure" }] };
    if (ch === "C2") return { ok: true, messages: [{ ts: "1700000400.0001", user: "U1", text: "my own note" }] };
  }
  if (m === "auth.revoke") return { ok: true };
};

test("callback: stores the account, encrypts the user token, then syncs", async () => {
  db.user = A;
  const net = stubFetch(slackApi());
  try {
    const r = await cb("code=abc&state=n", { nonce: "n", uid: A.id });
    assert.match(loc(r), /Connected Slack workspace Greenbridge/);
    const acct = db.rows("accounts")[0];
    assert.equal(acct.provider, "slack");
    assert.equal(acct.external_id, "T1:U1");
    assert.equal(acct.can_send, false);
    const sec = db.rows("account_secrets")[0].tokens_enc;
    assert.ok(!sec.includes("xoxp-SECRET"), "token must be encrypted at rest");
    assert.equal(JSON.parse(decrypt(sec)).access_token, "xoxp-SECRET");
    assert.equal(acct.status, "connected");
    assert.equal(db.rows("threads").length, 3);
  } finally { net.restore(); }
});

function seedSlack() {
  db.rows("accounts").push({ id: "s1", user_id: A.id, provider: "slack", account_type: "company", display_name: "Greenbridge", external_id: "T1:U1", status: "connected", can_send: false, sync_cursor: null });
  db.rows("account_secrets").push({ account_id: "s1", tokens_enc: encrypt(JSON.stringify({ access_token: "xoxp-1" })) });
}

test("sync: channels, DMs and private channels become threads with correct reply flags", async () => {
  seedSlack();
  const net = stubFetch(slackApi());
  try {
    const res = await syncAccount("s1");
    assert.equal(res.error, undefined);
    const t = (id: string) => db.rows("threads").find((x) => x.external_id === id)!;
    assert.equal(t("C1").subject, "#general");
    assert.equal(t("C1").needs_reply, false, "channels never flag needs-reply");
    assert.equal(t("C2").subject, "🔒secret");
    assert.equal(t("D1").subject, "DM · Dana Client");
    assert.equal(t("D1").needs_reply, true, "DM where they spoke last");
    assert.equal(t("D1").last_from, "Dana Client");
    assert.equal(t("C2").last_from, "You");

    const msgs = db.rows("messages");
    assert.equal(msgs.filter((m) => m.thread_id === t("C1").id).length, 1, "channel_join noise is skipped");
    assert.equal(msgs.find((m) => m.external_id === "C1:1700000200.0001")!.body_text, "Deploy done @Me & link (https://x.io)");
    assert.equal(msgs.find((m) => m.external_id === "D1:1700000250.0001")!.is_outgoing, true);

    await syncAccount("s1");
    assert.equal(db.rows("messages").length, 4, "re-sync is idempotent");
    assert.equal(db.rows("threads").length, 3);
  } finally { net.restore(); }
});

test("sync: a Slack 429 keeps the account connected, records a note, and resumes next time", async () => {
  seedSlack();
  let calls = 0;
  const net = stubFetch(slackApi({
    "conversations.history": (p) => {
      calls++;
      if (calls === 2) return new Response("{}", { status: 429, headers: { "retry-after": "30" } });
      const ch = p.get("channel");
      return { ok: true, messages: [{ ts: `17000005${ch!.charCodeAt(0)}.0001`, user: "U2", text: `hello from ${ch}` }] };
    },
  }));
  try {
    const res = await syncAccount("s1");
    assert.equal(res.error, undefined);
    assert.match(String(res.note), /rate limit/i);
    const acct = db.rows("accounts")[0];
    assert.equal(acct.status, "connected");
    assert.match(String(acct.status_detail), /rest sync next time/);
    assert.equal(db.rows("threads").length, 1, "only the conversation fetched before the 429 is stored");
    assert.equal(acct.sync_cursor, "1", "cursor advances so the next run starts where this one stopped");
  } finally { net.restore(); }
});

test("sync: revoked token => needs_reauth; other API errors => error; both visible", async () => {
  seedSlack();
  let net = stubFetch(slackApi({ "users.conversations": () => ({ ok: false, error: "token_revoked" }) }));
  try {
    await syncAccount("s1");
    assert.equal(db.rows("accounts")[0].status, "needs_reauth");
  } finally { net.restore(); }
  net = stubFetch(slackApi({ "users.conversations": () => ({ ok: false, error: "missing_scope" }) }));
  try {
    await syncAccount("s1");
    assert.equal(db.rows("accounts")[0].status, "error");
    assert.match(String(db.rows("accounts")[0].status_detail), /missing_scope/);
  } finally { net.restore(); }
});

test("sync: conversations the user can't read are skipped, not fatal", async () => {
  seedSlack();
  const net = stubFetch(slackApi({
    "conversations.history": (p) => p.get("channel") === "C1" ? { ok: false, error: "not_in_channel" } : p.get("channel") === "D1"
      ? { ok: true, messages: [{ ts: "1700000300.0001", user: "U2", text: "hi" }] } : { ok: true, messages: [] },
  }));
  try {
    const res = await syncAccount("s1");
    assert.equal(res.error, undefined);
    assert.equal(db.rows("accounts")[0].status, "connected");
    assert.equal(db.rows("threads").length, 1);
  } finally { net.restore(); }
});

test("disconnect: revokes the Slack token and removes the account (owner only)", async () => {
  seedSlack();
  const net = stubFetch(slackApi());
  try {
    assert.equal((await disconnectAccount(B.id, "s1")).ok, false);
    assert.equal(net.calls.length, 0);
    assert.equal((await disconnectAccount(A.id, "s1")).ok, true);
    assert.ok(net.calls.some((c) => c.url.endsWith("/auth.revoke")));
    assert.equal(db.rows("accounts").length, 0);
  } finally { net.restore(); }
});

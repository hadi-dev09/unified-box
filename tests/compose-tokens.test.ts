import { A, B, b64url, db, stubFetch } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { NextRequest } from "next/server";
import * as compose from "../src/app/api/compose/route";
import * as mcp from "../src/app/api/mcp/route";
import * as oidc from "../src/app/.well-known/openid-configuration/route";
import { createApiToken, revokeApiToken } from "../src/lib/api-tokens";
import { encrypt } from "../src/lib/crypto";
import { markSeen } from "../src/lib/threads";
import { syncAccount } from "../src/lib/sync";

beforeEach(() => db.reset());

function seedThread(user = A, opts: { canSend?: boolean; provider?: string } = {}) {
  db.rows("accounts").push({ id: `acct-${user.id}`, user_id: user.id, provider: opts.provider ?? "gmail", account_type: "personal", display_name: user.email, external_id: user.email, status: "connected", can_send: opts.canSend ?? true });
  db.rows("account_secrets").push({ account_id: `acct-${user.id}`, tokens_enc: encrypt(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3_600_000, scope: "x" })) });
  db.rows("threads").push({ id: `th-${user.id}`, user_id: user.id, account_id: `acct-${user.id}`, external_id: "gmail-thread-1", subject: "Plan", last_message_at: "2026-01-02T00:00:00Z", unread: true });
  db.rows("messages").push(
    { id: "m1", user_id: user.id, account_id: `acct-${user.id}`, thread_id: `th-${user.id}`, external_id: "x1", from_addr: "boss@acme.com", to_addrs: [user.email, "ann@acme.com"], cc_addrs: ["bob@acme.com"], sent_at: "2026-01-01T00:00:00Z", is_outgoing: false, rfc_message_id: "<one@acme.com>" },
    { id: "m2", user_id: user.id, account_id: `acct-${user.id}`, thread_id: `th-${user.id}`, external_id: "x2", from_addr: "boss@acme.com", to_addrs: [user.email], cc_addrs: [], sent_at: "2026-01-02T00:00:00Z", is_outgoing: false, rfc_message_id: "<two@acme.com>" },
  );
  return `th-${user.id}`;
}
const post = (b: object) => compose.POST(new NextRequest("https://app.test/api/compose", { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } }));
const send = (c: { url: string }) => (c.url.endsWith("/messages/send") ? { id: "s1" } : undefined);
const raw = (body: string) => Buffer.from(JSON.parse(body).raw, "base64url").toString();

test("compose: reply-all sends in-thread with Cc and threading headers", async () => {
  const th = seedThread();
  db.user = A;
  const net = stubFetch(send);
  try {
    const r = await post({ thread_id: th, mode: "reply_all", to: ["boss@acme.com"], cc: ["ann@acme.com", "bob@acme.com"], subject: "Re: Plan", body: "Sounds good", send: true });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    const sent = JSON.parse(net.calls[0].body);
    assert.equal(sent.threadId, "gmail-thread-1");
    const m = raw(net.calls[0].body);
    assert.match(m, /^To: boss@acme.com$/m);
    assert.match(m, /^Cc: ann@acme.com, bob@acme.com$/m);
    assert.match(m, /^In-Reply-To: <two@acme.com>$/m);
    assert.match(m, /^References: <one@acme.com> <two@acme.com>$/m);
    const d = db.rows("drafts")[0];
    assert.equal(d.created_by, "user");
    assert.equal(d.status, "sent");
    assert.equal(d.mode, "reply_all");
  } finally { net.restore(); }
});

test("compose: forward starts a new conversation (no threadId / In-Reply-To)", async () => {
  const th = seedThread();
  db.user = A;
  const net = stubFetch(send);
  try {
    const r = await post({ thread_id: th, mode: "forward", to: ["new@else.com"], subject: "Fwd: Plan", body: "FYI\n---------- Forwarded message ---------\n...", send: true });
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(net.calls[0].body).threadId, undefined);
    assert.doesNotMatch(raw(net.calls[0].body), /In-Reply-To/);
  } finally { net.restore(); }
});

test("compose: save-as-draft goes to Approvals and sends nothing", async () => {
  const th = seedThread();
  db.user = A;
  const net = stubFetch(send);
  try {
    const r = await post({ thread_id: th, mode: "reply", to: ["boss@acme.com"], subject: "Re: Plan", body: "later", send: false });
    assert.equal((await r.json()).status, "pending");
    assert.equal(net.calls.length, 0);
    assert.equal(db.rows("drafts")[0].status, "pending");
  } finally { net.restore(); }
});

test("compose: guards (auth, ownership, read-only, Slack, bad input)", async () => {
  const th = seedThread(A, { canSend: false });
  const thB = seedThread(B);
  const net = stubFetch(send);
  try {
    db.user = null;
    assert.equal((await post({ thread_id: th, mode: "reply", to: ["a@b.co"], subject: "s", body: "b", send: true })).status, 401);
    db.user = A;
    assert.equal((await post({ thread_id: thB, mode: "reply", to: ["a@b.co"], subject: "s", body: "b", send: true })).status, 404, "other user's thread");
    const ro = await post({ thread_id: th, mode: "reply", to: ["a@b.co"], subject: "s", body: "b", send: true });
    assert.equal(ro.status, 400);
    assert.match((await ro.json()).error, /read-only/);
    assert.equal((await post({ thread_id: th, mode: "nope", to: ["a@b.co"], subject: "s", body: "b" })).status, 400);
    assert.equal((await post({ thread_id: th, mode: "reply", to: ["not-email"], subject: "s", body: "b" })).status, 400);
    assert.equal((await post({ thread_id: th, mode: "reply", to: [], subject: "s", body: "b" })).status, 400);
    assert.equal((await post({ thread_id: th, mode: "reply", to: ["a@b.co"], subject: "s", body: "  " })).status, 400);
    assert.equal((await post({ thread_id: th, mode: "reply", to: Array.from({ length: 51 }, (_, i) => `u${i}@b.co`), subject: "s", body: "b" })).status, 400);
    assert.equal(net.calls.length, 0, "nothing may be sent by any guarded request");
  } finally { net.restore(); }
  db.reset();
  const ths = seedThread(A, { provider: "slack" });
  db.user = A;
  const r = await post({ thread_id: ths, mode: "reply", to: ["a@b.co"], subject: "s", body: "b", send: true });
  assert.match((await r.json()).error, /only available for Gmail/);
});

test("read state: opening a thread marks it read, and a re-sync doesn't flip it back", async () => {
  const th = seedThread();
  await markSeen(B.id, th);
  assert.equal(db.rows("threads")[0].unread, true, "other users can't mark my thread");
  await markSeen(A.id, th);
  assert.equal(db.rows("threads")[0].unread, false);

  // Gmail still reports the (older) message as UNREAD
  const old = { id: "x2", threadId: "gmail-thread-1", internalDate: String(Date.parse("2026-01-02T00:00:00Z")), snippet: "s", labelIds: ["UNREAD"], payload: { mimeType: "text/plain", body: { data: b64url("hi") }, headers: [{ name: "From", value: "boss@acme.com" }, { name: "To", value: A.email }, { name: "Subject", value: "Plan" }] } };
  let net = stubFetch((c) => c.url.includes("/messages?") ? { messages: [{ id: "x2" }] } : c.url.includes("/messages/x2") ? old : undefined);
  try { await syncAccount(`acct-${A.id}`); } finally { net.restore(); }
  assert.equal(db.rows("threads")[0].unread, false, "stays read after sync");

  // a NEW unread message arrives after I read it -> unread again
  const fresh = { ...old, id: "x3", internalDate: String(Date.now() + 60_000) };
  net = stubFetch((c) => c.url.includes("/messages?") ? { messages: [{ id: "x2" }, { id: "x3" }] } : c.url.includes("/messages/x2") ? old : c.url.includes("/messages/x3") ? fresh : undefined);
  try { await syncAccount(`acct-${A.id}`); } finally { net.restore(); }
  assert.equal(db.rows("threads")[0].unread, true, "new mail makes it unread again");
});

// ---------- personal access keys ----------
const rpc = (token: string | null, body: unknown) =>
  mcp.POST(new NextRequest("https://app.test/api/mcp", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) } }));

test("access keys: shown once, stored hashed, work for MCP, revocable, per-user", async () => {
  seedThread(A); seedThread(B);
  const { token } = await createApiToken(A.id, "Cursor");
  assert.ok(token?.startsWith("ubx_"));
  assert.ok(!JSON.stringify(db.rows("api_tokens")).includes(token!), "only the hash is stored");
  const list = await rpc(token!, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_accounts", arguments: {} } });
  assert.equal(list.status, 200);
  const accts = JSON.parse((await list.json()).result.content[0].text);
  assert.deepEqual(accts.map((a: { display_name: string }) => a.display_name), [A.email]);
  assert.ok(db.rows("api_tokens")[0].last_used_at, "usage recorded");

  await revokeApiToken(B.id, db.rows("api_tokens")[0].id);
  assert.equal((await rpc(token!, { jsonrpc: "2.0", id: 1, method: "ping" })).status, 200, "B can't revoke A's key");
  await revokeApiToken(A.id, db.rows("api_tokens")[0].id);
  assert.equal((await rpc(token!, { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
  assert.equal((await rpc("ubx_made_up", { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
});

test("access keys: capped at 20 active per user", async () => {
  for (let i = 0; i < 20; i++) assert.ok((await createApiToken(A.id, `k${i}`)).token);
  assert.match(String((await createApiToken(A.id, "one more")).error), /20 active keys/);
  assert.ok((await createApiToken(B.id, "b")).token, "limit is per user");
});

// ---------- protocol compatibility ----------
test("MCP: version negotiation, annotations, batching, CORS, OIDC discovery alias", async () => {
  const { token } = await createApiToken(A.id, "t");
  const init = async (v: string) => (await (await rpc(token!, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v } })).json()).result.protocolVersion;
  assert.equal(await init("2025-03-26"), "2025-03-26");
  assert.equal(await init("2025-11-25"), "2025-11-25");
  assert.equal(await init("1999-01-01"), "2025-06-18");

  const tl = (await (await rpc(token!, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json()).result.tools;
  for (const t of tl) assert.equal(typeof t.annotations.readOnlyHint, "boolean", t.name);
  assert.equal(tl.find((t: { name: string }) => t.name === "draft_reply").annotations.readOnlyHint, false);
  assert.equal(tl.filter((t: { annotations: { readOnlyHint: boolean } }) => t.annotations.readOnlyHint).length, 6);

  const batch = await (await rpc(token!, [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "nope" }])).json();
  assert.equal(batch.length, 2);
  assert.equal(batch[1].error.code, -32601);

  const pre = mcp.OPTIONS();
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get("access-control-allow-headers")!, /authorization/);
  const unauth = await rpc(null, { jsonrpc: "2.0", id: 1, method: "ping" });
  assert.match(unauth.headers.get("access-control-expose-headers")!, /www-authenticate/);
  assert.equal((await mcp.GET()).status, 405);

  const meta = await (await oidc.GET()).json();
  assert.equal(meta.token_endpoint, "https://app.test/api/oauth/token");
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
});

test("MCP: works with the official MCP TypeScript SDK client (Streamable HTTP)", async () => {
  seedThread(A);
  const { token } = await createApiToken(A.id, "sdk");
  // Bridge a real HTTP server to the route handler, then connect the official client to it.
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await mcp.POST(new NextRequest(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === "POST" ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "compat-test", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    assert.equal(client.getServerVersion()?.name, "unified-box");
    const { tools } = await client.listTools();
    assert.equal(tools.length, 7);
    const res = await client.callTool({ name: "list_threads", arguments: { limit: 5 } });
    const out = JSON.parse((res.content as { text: string }[])[0].text);
    assert.equal(out.threads.length, 1);
    assert.equal(out.threads[0].subject, "Plan");
  } finally {
    await client.close().catch(() => {});
    server.close();
  }
});

test("MCP sync_inbox: syncs only the token user's inboxes and is throttled to once a minute", async () => {
  seedThread(A); seedThread(B);
  db.rows("accounts").forEach((a) => (a.last_synced_at = null));
  const { token } = await createApiToken(A.id, "t");
  const net = stubFetch((c) => (c.url.includes("/messages?") ? { messages: [] } : undefined));
  try {
    const call = async () => JSON.parse((await (await rpc(token!, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "sync_inbox", arguments: {} } })).json()).result.content[0].text);
    const first = await call();
    assert.equal(first.synced.length, 1);
    assert.equal(first.synced[0].inbox, A.email);
    assert.equal(net.calls.length, 1, "only A's Gmail was contacted");
    const second = await call();
    assert.match(second.note, /less than a minute/);
    assert.equal(net.calls.length, 1, "throttled");
    assert.equal(db.rows("accounts").find((a) => a.user_id === B.id)!.last_synced_at, null, "B untouched");
  } finally { net.restore(); }
});

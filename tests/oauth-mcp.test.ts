import { A, B, db } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as register from "../src/app/api/oauth/register/route";
import * as tokenRoute from "../src/app/api/oauth/token/route";
import * as mcp from "../src/app/api/mcp/route";
import { pkceChallenge, randomToken, sha256 } from "../src/lib/oauth";
import { stubFetch } from "./setup";

const REDIRECT = "https://claude.example/callback";
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const post = (url: string, body: string, headers: Record<string, string> = {}) => new NextRequest(url, { method: "POST", body, headers });

async function newClient() {
  const r = await register.POST(post("https://app.test/api/oauth/register", JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }), { "content-type": "application/json" }));
  assert.equal(r.status, 201);
  return (await r.json()).client_id as string;
}
async function seedCode(clientId: string, userId = A.id, over: Record<string, unknown> = {}) {
  const verifier = randomToken(), code = randomToken();
  await db.from("oauth_codes").insert({ code_hash: sha256(code), client_id: clientId, user_id: userId, redirect_uri: REDIRECT, code_challenge: pkceChallenge(verifier), expires_at: new Date(Date.now() + 600_000).toISOString(), ...over });
  return { code, verifier };
}
const exchange = (o: Record<string, string>) => tokenRoute.POST(post("https://app.test/api/oauth/token", form(o), { "content-type": "application/x-www-form-urlencoded" }));

beforeEach(() => db.reset());

test("dynamic registration rejects unsafe redirect URIs and accepts https", async () => {
  for (const bad of ["javascript:alert(1)", "http://evil.example/cb", "ftp://x/y", "https://x/y#frag", "not a url"]) {
    const r = await register.POST(post("https://app.test/api/oauth/register", JSON.stringify({ redirect_uris: [bad] }), { "content-type": "application/json" }));
    assert.equal(r.status, 400, bad);
  }
  const ok = await register.POST(post("https://app.test/api/oauth/register", JSON.stringify({ redirect_uris: ["http://localhost:3000/cb"] }), { "content-type": "application/json" }));
  assert.equal(ok.status, 201);
});

test("authorization code flow: PKCE, single use, redirect + client binding", async () => {
  const cid = await newClient();
  const { code, verifier } = await seedCode(cid);

  // wrong verifier -> rejected (and code is burned: attacker can't retry)
  let r = await exchange({ grant_type: "authorization_code", client_id: cid, code, code_verifier: "x".repeat(43), redirect_uri: REDIRECT });
  assert.equal(r.status, 400);
  r = await exchange({ grant_type: "authorization_code", client_id: cid, code, code_verifier: verifier, redirect_uri: REDIRECT });
  assert.equal(r.status, 400, "burned code must not work even with the right verifier");

  // good exchange
  const c2 = await seedCode(cid);
  r = await exchange({ grant_type: "authorization_code", client_id: cid, code: c2.code, code_verifier: c2.verifier, redirect_uri: REDIRECT });
  assert.equal(r.status, 200);
  const t = await r.json();
  assert.equal(t.token_type, "Bearer");
  assert.ok(t.access_token && t.refresh_token);
  // tokens are stored hashed only
  assert.ok(!JSON.stringify(db.rows("oauth_tokens")).includes(t.access_token));

  // replay of the same code fails
  r = await exchange({ grant_type: "authorization_code", client_id: cid, code: c2.code, code_verifier: c2.verifier, redirect_uri: REDIRECT });
  assert.equal(r.status, 400);

  // wrong redirect_uri / wrong client / expired
  const c3 = await seedCode(cid);
  assert.equal((await exchange({ grant_type: "authorization_code", client_id: cid, code: c3.code, code_verifier: c3.verifier, redirect_uri: "https://evil.example/cb" })).status, 400);
  const other = await newClient();
  const c4 = await seedCode(cid);
  assert.equal((await exchange({ grant_type: "authorization_code", client_id: other, code: c4.code, code_verifier: c4.verifier, redirect_uri: REDIRECT })).status, 400);
  const c5 = await seedCode(cid, A.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await exchange({ grant_type: "authorization_code", client_id: cid, code: c5.code, code_verifier: c5.verifier, redirect_uri: REDIRECT })).status, 400);
  // unknown client
  assert.equal((await exchange({ grant_type: "authorization_code", client_id: "nope", code: c5.code, code_verifier: c5.verifier, redirect_uri: REDIRECT })).status, 401);
});

test("refresh tokens rotate, and replaying an old one revokes the whole grant", async () => {
  const cid = await newClient();
  const c = await seedCode(cid);
  const t1 = await (await exchange({ grant_type: "authorization_code", client_id: cid, code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT })).json();

  const r2 = await exchange({ grant_type: "refresh_token", client_id: cid, refresh_token: t1.refresh_token });
  assert.equal(r2.status, 200);
  const t2 = await r2.json();
  assert.notEqual(t2.refresh_token, t1.refresh_token);

  // t2's access token works on MCP
  const ok = await mcp.POST(post("https://app.test/api/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), { authorization: `Bearer ${t2.access_token}`, "content-type": "application/json" }));
  assert.equal(ok.status, 200);

  // attacker replays stolen t1 refresh token -> rejected AND everything revoked
  const replay = await exchange({ grant_type: "refresh_token", client_id: cid, refresh_token: t1.refresh_token });
  assert.equal(replay.status, 400);
  const after = await mcp.POST(post("https://app.test/api/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), { authorization: `Bearer ${t2.access_token}`, "content-type": "application/json" }));
  assert.equal(after.status, 401, "grant must be revoked after refresh-token reuse");
  assert.equal((await exchange({ grant_type: "refresh_token", client_id: cid, refresh_token: t2.refresh_token })).status, 400);
});

test("expired access token and wrong-client refresh are rejected", async () => {
  const cid = await newClient();
  const c = await seedCode(cid);
  const t = await (await exchange({ grant_type: "authorization_code", client_id: cid, code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT })).json();
  for (const row of db.rows("oauth_tokens")) row.expires_at = new Date(Date.now() - 1000).toISOString();
  const r = await mcp.POST(post("https://app.test/api/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), { authorization: `Bearer ${t.access_token}`, "content-type": "application/json" }));
  assert.equal(r.status, 401);
  assert.equal((await exchange({ grant_type: "refresh_token", client_id: await newClient(), refresh_token: t.refresh_token })).status, 400);
});

// ---------- MCP tools ----------
async function tokenFor(userId: string) {
  const cid = await newClient();
  const c = await seedCode(cid, userId);
  return (await (await exchange({ grant_type: "authorization_code", client_id: cid, code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT })).json()).access_token as string;
}
async function rpc(bearer: string | null, method: string, params?: unknown, notification = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const msg = notification ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: 1, method, params };
  const res = await mcp.POST(post("https://app.test/api/mcp", JSON.stringify(msg), headers));
  return { res, body: res.status === 202 ? null : await res.json().catch(() => null) };
}
const callTool = async (bearer: string, name: string, args: unknown) => {
  const { body } = await rpc(bearer, "tools/call", { name, arguments: args });
  const text: string = body.result.content[0].text;
  return { isError: body.result.isError as boolean | undefined, out: body.result.isError ? { error: text } : JSON.parse(text) };
};

function seedMail() {
  const mk = (user: string, email: string, tag: string) => {
    const acct = `acct-${tag}`, thread = `thread-${tag}`;
    db.rows("accounts").push({ id: acct, user_id: user, provider: "gmail", account_type: "personal", display_name: email, external_id: email, status: "connected", can_send: true });
    db.rows("threads").push({ id: thread, user_id: user, account_id: acct, external_id: `ext-${tag}`, subject: `Invoice ${tag}`, snippet: "s", last_message_at: new Date().toISOString(), unread: tag === "A", needs_reply: true, last_from: "Client" });
    db.rows("messages").push({ id: `m-${tag}`, user_id: user, account_id: acct, thread_id: thread, external_id: `e-${tag}`, from_addr: `client-${tag}@acme.com`, from_name: "Client", to_addrs: [email], subject: `Invoice ${tag}`, body_text: `Please pay secret-${tag}`, sent_at: new Date().toISOString(), is_outgoing: false });
  };
  mk(A.id, A.email, "A");
  mk(B.id, B.email, "B");
}

test("MCP: unauthenticated calls get a 401 with the OAuth discovery header", async () => {
  for (const b of [null, "garbage"]) {
    const { res } = await rpc(b, "ping");
    assert.equal(res.status, 401);
    assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/app\.test\/\.well-known\/oauth-protected-resource"/);
  }
});

test("MCP: protocol basics and the tool surface has no send/delete", async () => {
  const tok = await tokenFor(A.id);
  const init = await rpc(tok, "initialize", {});
  assert.equal(init.body.result.serverInfo.name, "unified-box");
  assert.equal((await rpc(tok, "notifications/initialized", undefined, true)).res.status, 202);
  const list = await rpc(tok, "tools/list");
  const names: string[] = list.body.result.tools.map((t: { name: string }) => t.name);
  assert.deepEqual(names.sort(), ["daily_digest", "draft_reply", "get_thread", "list_accounts", "list_threads", "search_messages"]);
  assert.ok(!names.some((n) => /send|delete|remove|archive/.test(n)));
  for (const t of list.body.result.tools) assert.equal(t.inputSchema.type, "object");
  assert.equal((await rpc(tok, "nope")).body.error.code, -32601);
});

test("MCP: every tool is scoped to the token's user (no cross-tenant reads)", async () => {
  seedMail();
  const tok = await tokenFor(A.id);

  const accts = (await callTool(tok, "list_accounts", {})).out;
  assert.deepEqual(accts.map((a: { display_name: string }) => a.display_name), [A.email]);

  const threads = (await callTool(tok, "list_threads", {})).out.threads;
  assert.deepEqual(threads.map((t: { id: string }) => t.id), ["thread-A"]);
  assert.equal((await callTool(tok, "list_threads", { unread_only: true })).out.threads.length, 1);

  assert.equal((await callTool(tok, "get_thread", { thread_id: "00000000-0000-4000-8000-00000000000b" })).out.error, "thread not found");
  db.rows("threads").find((t) => t.id === "thread-B")!.id = "11111111-1111-4111-8111-111111111111";
  assert.equal((await callTool(tok, "get_thread", { thread_id: "11111111-1111-4111-8111-111111111111" })).out.error, "thread not found");

  const mine = (await callTool(tok, "search_messages", { query: "secret-A" })).out.results;
  assert.equal(mine.length, 1);
  assert.equal((await callTool(tok, "search_messages", { query: "secret-B" })).out.results.length, 0);

  const digest = (await callTool(tok, "daily_digest", { hours: 24 })).out;
  assert.deepEqual(Object.keys(digest.by_inbox), [A.email]);
  assert.match(digest.notice, /untrusted/);
});

test("MCP: input validation, and search treats wildcards literally", async () => {
  seedMail();
  const tok = await tokenFor(A.id);
  assert.equal((await callTool(tok, "get_thread", { thread_id: "not-a-uuid" })).isError, true);
  assert.equal((await callTool(tok, "list_threads", { limit: 9999 })).isError, true);
  assert.equal((await callTool(tok, "search_messages", { query: "x" })).isError, true);
  assert.equal((await callTool(tok, "search_messages", { query: "%%,body_text.ilike.%" })).out.results.length, 0);
  const { body } = await rpc(tok, "tools/call", { name: "does_not_exist", arguments: {} });
  assert.equal(body.error.code, -32602);
});

test("MCP: draft_reply only creates a pending draft; it never sends", async () => {
  seedMail();
  const tok = await tokenFor(A.id);
  assert.equal((await callTool(tok, "draft_reply", { thread_id: "not-a-uuid", body: "x" })).isError, true);

  db.rows("threads").find((t) => t.id === "thread-A")!.id = "22222222-2222-4222-8222-222222222222";
  db.rows("messages").find((m) => m.id === "m-A")!.thread_id = "22222222-2222-4222-8222-222222222222";
  const net2 = stubFetch(() => undefined);
  try {
    const out = (await callTool(tok, "draft_reply", { thread_id: "22222222-2222-4222-8222-222222222222", body: "On it!" })).out;
    assert.equal(out.status, "pending");
    assert.equal(net2.calls.length, 0, "no network call may happen when drafting");
  } finally { net2.restore(); }
  const d = db.rows("drafts")[0];
  assert.equal(d.status, "pending");
  assert.equal(d.created_by, "claude");
  assert.deepEqual(d.to_addrs, ["client-A@acme.com"]);
  assert.equal(d.subject, "Re: Invoice A");
  assert.equal(d.user_id, A.id);
  assert.ok(db.rows("audit_log").some((a) => a.action === "draft.created" && a.actor === "claude"));

  // another user's thread cannot be drafted against
  db.rows("threads").find((t) => t.id === "thread-B")!.id = "33333333-3333-4333-8333-333333333333";
  assert.equal((await callTool(tok, "draft_reply", { thread_id: "33333333-3333-4333-8333-333333333333", body: "hi" })).out.error, "thread not found");
  assert.equal(db.rows("drafts").length, 1);
});

import { A, B, b64url, db, stubFetch } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as draftsRoute from "../src/app/api/drafts/[id]/route";
import * as syncRoute from "../src/app/api/sync/route";
import * as connect from "../src/app/api/connect/gmail/route";
import * as callback from "../src/app/api/connect/gmail/callback/route";
import { decrypt, encrypt } from "../src/lib/crypto";
import { syncAccount } from "../src/lib/sync";

beforeEach(() => db.reset());

const GOOD_TOKENS = () => encrypt(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3_600_000, scope: "x" }));
function seedAccount(user = A, over: Record<string, unknown> = {}) {
  const id = `acct-${Math.random().toString(36).slice(2)}`;
  db.rows("accounts").push({ id, user_id: user.id, provider: "gmail", account_type: "personal", display_name: user.email, external_id: user.email, status: "connected", can_send: true, ...over });
  db.rows("account_secrets").push({ account_id: id, tokens_enc: GOOD_TOKENS() });
  return id;
}
function seedDraft(accountId: string, user = A, over: Record<string, unknown> = {}) {
  const id = `draft-${Math.random().toString(36).slice(2)}`;
  db.rows("drafts").push({ id, user_id: user.id, account_id: accountId, thread_id: null, to_addrs: ["client@acme.com"], subject: "Re: Hi", body: "Thanks!", status: "pending", created_by: "claude", ...over });
  return id;
}
const act = (id: string, action: string) =>
  draftsRoute.POST(new NextRequest(`https://app.test/api/drafts/${id}`, { method: "POST", body: JSON.stringify({ action }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id }) });
const gmailSend = (c: { url: string }) => c.url.endsWith("/messages/send") ? { id: "sent-1" } : undefined;

// ---------- draft approval ----------
test("approval: requires a signed-in human session", async () => {
  const d = seedDraft(seedAccount());
  const net = stubFetch(gmailSend);
  try {
    db.user = null;
    assert.equal((await act(d, "approve")).status, 401);
    assert.equal(net.calls.length, 0);
    assert.equal(db.rows("drafts")[0].status, "pending");
  } finally { net.restore(); }
});

test("approval: a user cannot approve someone else's draft", async () => {
  const d = seedDraft(seedAccount(B), B);
  const net = stubFetch(gmailSend);
  try {
    db.user = A;
    assert.equal((await act(d, "approve")).status, 404);
    assert.equal(net.calls.length, 0);
    assert.equal(db.rows("drafts")[0].status, "pending");
  } finally { net.restore(); }
});

test("approval: approve sends exactly once via Gmail, logs it, and cannot be repeated", async () => {
  const d = seedDraft(seedAccount());
  db.user = A;
  const net = stubFetch(gmailSend);
  try {
    const r = await act(d, "approve");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, "sent");
    assert.equal(net.calls.length, 1);
    assert.equal(db.rows("drafts")[0].status, "sent");
    assert.deepEqual(db.rows("audit_log").map((a) => a.action).sort(), ["draft.approve", "draft.sent"]);
    // double click / replay
    assert.equal((await act(d, "approve")).status, 404);
    assert.equal(net.calls.length, 1, "must not send twice");
  } finally { net.restore(); }
});

test("approval: read-only accounts fail safely without calling Gmail", async () => {
  const d = seedDraft(seedAccount(A, { can_send: false }));
  db.user = A;
  const net = stubFetch(gmailSend);
  try {
    const r = await act(d, "approve");
    assert.equal(r.status, 502);
    assert.equal(net.calls.length, 0);
    assert.equal(db.rows("drafts")[0].status, "failed");
    assert.match(String(db.rows("drafts")[0].error), /read-only/);
  } finally { net.restore(); }
});

test("approval: reject never sends; bad actions are refused", async () => {
  const d = seedDraft(seedAccount());
  db.user = A;
  const net = stubFetch(gmailSend);
  try {
    assert.equal((await act(d, "delete")).status, 400);
    assert.equal((await act(d, "reject")).status, 200);
    assert.equal(db.rows("drafts")[0].status, "rejected");
    assert.equal((await act(d, "approve")).status, 404, "a rejected draft can't be approved later");
    assert.equal(net.calls.length, 0);
  } finally { net.restore(); }
});

test("approval: header injection via subject is neutralised; via recipient is rejected outright", async () => {
  db.user = A;
  const net = stubFetch(gmailSend);
  try {
    const d = seedDraft(seedAccount(), A, { subject: "Hi\r\nBcc: attacker@evil.com" });
    await act(d, "approve");
    const raw = Buffer.from(JSON.parse(net.calls[0].body).raw, "base64url").toString();
    const headerBlock = raw.split("\r\n\r\n")[0];
    assert.ok(!/^Bcc:/im.test(headerBlock), headerBlock);
    assert.equal(headerBlock.split("\r\n").length, 5); // From, To, Subject, MIME-Version, Content-Type

    const d2 = seedDraft(seedAccount(), A, { to_addrs: ["ok@acme.com\r\nBcc: attacker2@evil.com"] });
    assert.equal((await act(d2, "approve")).status, 502);
    assert.equal(net.calls.length, 1, "the malicious recipient must never reach Gmail");
  } finally { net.restore(); }
});

test("approval: the human's edits are what gets sent (and are validated)", async () => {
  const d = seedDraft(seedAccount());
  db.user = A;
  const net = stubFetch(gmailSend);
  try {
    const bad = async (payload: object) => draftsRoute.POST(new NextRequest("https://app.test/api/drafts/x", { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: d }) });
    assert.equal((await bad({ action: "approve", body: "   " })).status, 400);
    assert.equal((await bad({ action: "approve", body: "x".repeat(10_001) })).status, 400);
    assert.equal((await bad({ action: "approve", subject: 5 })).status, 400);
    assert.equal(db.rows("drafts")[0].status, "pending", "invalid edits must not consume the draft");
    assert.equal(net.calls.length, 0);

    const ok = await bad({ action: "approve", subject: "Edited\r\nsubject", body: "Edited by the human" });
    assert.equal(ok.status, 200);
    const raw = Buffer.from(JSON.parse(net.calls[0].body).raw, "base64url").toString();
    assert.match(raw, /Subject: Edited subject/);
    assert.match(raw, /Edited by the human/);
    assert.doesNotMatch(raw, /Thanks!/);
    assert.equal(db.rows("drafts")[0].body, "Edited by the human");
    assert.equal(db.rows("audit_log").find((a) => a.action === "draft.approve")!.meta.edited, true);
  } finally { net.restore(); }
});

test("approval: edits on reject are ignored; invalid recipients never reach Gmail", async () => {
  db.user = A;
  const net = stubFetch(gmailSend);
  try {
    const d1 = seedDraft(seedAccount());
    await draftsRoute.POST(new NextRequest("https://app.test/x", { method: "POST", body: JSON.stringify({ action: "reject", body: "sneaky" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: d1 }) });
    assert.equal(db.rows("drafts")[0].body, "Thanks!");

    const d2 = seedDraft(seedAccount(), A, { to_addrs: ["not-an-email"] });
    const r = await act(d2, "approve");
    assert.equal(r.status, 502);
    assert.equal(net.calls.length, 0);
    assert.match(String(db.rows("drafts").find((x) => x.id === d2)!.error), /Invalid recipient/);
  } finally { net.restore(); }
});

// ---------- connect / callback ----------
test("connect: requires login", async () => {
  db.user = null;
  const r = await connect.GET(new NextRequest("https://app.test/api/connect/gmail?type=company&write=1"));
  assert.match(r.headers.get("location") ?? "", /\/login$/);
  db.user = A;
  const ok = await connect.GET(new NextRequest("https://app.test/api/connect/gmail?type=company&write=1"));
  const loc = new URL(ok.headers.get("location")!);
  assert.equal(loc.host, "accounts.google.com");
  assert.equal(loc.searchParams.get("redirect_uri"), "https://app.test/api/connect/gmail/callback");
  assert.match(loc.searchParams.get("scope")!, /gmail\.send/);
  assert.equal(loc.searchParams.get("access_type"), "offline");
  const cookie = ok.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/i);
  const ro = new URL((await connect.GET(new NextRequest("https://app.test/api/connect/gmail"))).headers.get("location")!);
  assert.ok(!/gmail\.send/.test(ro.searchParams.get("scope")!), "default is read-only");
});

const idToken = (email: string) => `h.${b64url(JSON.stringify({ email }))}.s`;
const cb = (qs: string, cookie?: object) => callback.GET(new NextRequest(`https://app.test/api/connect/gmail/callback?${qs}`, { headers: cookie ? { cookie: `gmail_oauth=${encodeURIComponent(JSON.stringify(cookie))}` } : {} }));
const loc = (r: Response) => decodeURIComponent(r.headers.get("location") ?? "");

test("callback: rejects missing cookie, bad state and a different signed-in user", async () => {
  db.user = A;
  assert.match(loc(await cb("code=x&state=n")), /expired/i);
  assert.match(loc(await cb("code=x&state=WRONG", { nonce: "n", uid: A.id, type: "personal", write: false })), /Invalid connection/);
  assert.match(loc(await cb("code=x&state=n", { nonce: "n", uid: B.id, type: "personal", write: false })), /Invalid connection/);
  assert.equal(db.rows("accounts").length, 0);
});

test("callback: a Workspace-blocked / denied consent explains itself", async () => {
  db.user = A;
  const r = await cb("error=access_denied&state=n", { nonce: "n", uid: A.id, type: "company", write: false });
  assert.match(loc(r), /admin may be blocking/i);
  assert.equal(db.rows("accounts").length, 0);
});

test("callback: success stores account + encrypted tokens, logs, and syncs", async () => {
  db.user = A;
  const net = stubFetch((c) => {
    if (c.url === "https://oauth2.googleapis.com/token") return { access_token: "AT-secret", refresh_token: "RT-secret", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/gmail.readonly", id_token: idToken("work@company.com") };
    if (c.url.includes("/messages?")) return { messages: [] };
  });
  try {
    const r = await cb("code=abc&state=n", { nonce: "n", uid: A.id, type: "company", write: false });
    assert.match(loc(r), /Connected work@company\.com/);
    const acct = db.rows("accounts")[0];
    assert.equal(acct.account_type, "company");
    assert.equal(acct.can_send, false);
    const sec = db.rows("account_secrets")[0];
    assert.ok(!sec.tokens_enc.includes("RT-secret") && !sec.tokens_enc.includes("AT-secret"), "tokens must be encrypted at rest");
    assert.equal(JSON.parse(decrypt(sec.tokens_enc)).refresh_token, "RT-secret");
    assert.ok(db.rows("audit_log").some((a) => a.action === "account.connected"));
    assert.equal(acct.status, "connected");
    assert.ok(acct.last_synced_at);
    assert.ok(net.calls.some((c) => c.url.includes("/messages?")), "initial sync ran");
  } finally { net.restore(); }
});

test("callback: reconnecting the same address updates in place (no duplicate)", async () => {
  db.user = A;
  const net = stubFetch((c) => c.url === "https://oauth2.googleapis.com/token"
    ? { access_token: "a", refresh_token: "r", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/gmail.send", id_token: idToken("me@x.com") }
    : { messages: [] });
  try {
    await cb("code=1&state=n", { nonce: "n", uid: A.id, type: "personal", write: true });
    await cb("code=2&state=n", { nonce: "n", uid: A.id, type: "personal", write: true });
    assert.equal(db.rows("accounts").length, 1);
    assert.equal(db.rows("accounts")[0].can_send, true);
  } finally { net.restore(); }
});

test("callback: Google returning no refresh token fails cleanly", async () => {
  db.user = A;
  const net = stubFetch(() => ({ access_token: "a", expires_in: 3600, scope: "x", id_token: idToken("a@b.com") }));
  try {
    assert.match(loc(await cb("code=1&state=n", { nonce: "n", uid: A.id, type: "personal", write: false })), /Could not connect/);
    assert.equal(db.rows("accounts").length, 0);
  } finally { net.restore(); }
});

// ---------- sync ----------
const gm = (id: string, o: { from: string; subject: string; labels?: string[]; extra?: [string, string][]; html?: string; text?: string; ts: number; snippet?: string }) => ({
  id, threadId: `t-${id}`, internalDate: String(o.ts), snippet: o.snippet ?? "snip", labelIds: o.labels ?? [],
  payload: {
    mimeType: "multipart/alternative",
    headers: [{ name: "From", value: o.from }, { name: "To", value: "a@example.com" }, { name: "Subject", value: o.subject }, ...(o.extra ?? []).map(([name, value]) => ({ name, value }))],
    parts: [
      ...(o.text ? [{ mimeType: "text/plain", body: { data: b64url(o.text) } }] : []),
      ...(o.html ? [{ mimeType: "text/html", body: { data: b64url(o.html) } }] : []),
    ],
  },
});

test("sync: HTML-only mail gets readable bodies; newsletters don't need replies; humans do", async () => {
  const acct = seedAccount();
  const msgs: Record<string, unknown> = {
    h1: gm("h1", { from: '"Jane Client" <jane@acme.com>', subject: "Quick question", text: "Can you send the report?", ts: 1_700_000_000_000, labels: ["UNREAD", "INBOX"] }),
    n1: gm("n1", { from: "Deals <deals@shop.com>", subject: "70% off", html: "<style>x{}</style><p>Big&nbsp;sale &amp; more</p><a href='https://x'>Shop</a>", ts: 1_700_000_100_000, labels: ["CATEGORY_PROMOTIONS"], extra: [["List-Unsubscribe", "<mailto:u@shop.com>"]], snippet: "you&#39;ve won" }),
    s1: gm("s1", { from: "Supabase Auth <noreply@mail.app.supabase.io>", subject: "Your sign-in link", html: "<p>Follow the link</p>", ts: 1_700_000_200_000 }),
    o1: gm("o1", { from: "A <a@example.com>", subject: "My own mail", text: "Sent by me", ts: 1_700_000_300_000 }),
  };
  const net = stubFetch((c) => {
    if (c.url.includes("/messages?")) return { messages: Object.keys(msgs).map((id) => ({ id })) };
    const m = c.url.match(/\/messages\/(\w+)\?format=full/);
    if (m) return msgs[m[1]];
  });
  try {
    const res = await syncAccount(acct);
    assert.equal(res.synced, 4);
    const body = (ext: string) => db.rows("messages").find((m) => m.external_id === ext)!.body_text;
    assert.equal(body("h1"), "Can you send the report?");
    assert.equal(body("n1"), "Big sale & more\nShop");
    assert.equal(body("s1"), "Follow the link");
    const t = (ext: string) => db.rows("threads").find((x) => x.external_id === `t-${ext}`)!;
    assert.equal(t("h1").needs_reply, true);
    assert.equal(t("h1").unread, true);
    assert.equal(t("h1").last_from, "Jane Client");
    assert.equal(t("n1").needs_reply, false);
    assert.equal(t("n1").snippet, "you've won");
    assert.equal(t("s1").needs_reply, false);
    assert.equal(t("o1").needs_reply, false);
    assert.equal(t("o1").last_from, "You");
    assert.equal(db.rows("accounts")[0].status, "connected");
    // re-sync is idempotent
    await syncAccount(acct);
    assert.equal(db.rows("messages").length, 4);
    assert.equal(db.rows("threads").length, 4);
  } finally { net.restore(); }
});

test("sync: expired access token is refreshed and the new token is stored encrypted", async () => {
  const acct = seedAccount();
  db.rows("account_secrets")[0].tokens_enc = encrypt(JSON.stringify({ access_token: "old", refresh_token: "rt", expires_at: Date.now() - 1000, scope: "x" }));
  const net = stubFetch((c) => {
    if (c.url === "https://oauth2.googleapis.com/token") return { access_token: "fresh", expires_in: 3600 };
    if (c.url.includes("/messages?")) return { messages: [] };
  });
  try {
    await syncAccount(acct);
    assert.equal(JSON.parse(decrypt(db.rows("account_secrets")[0].tokens_enc)).access_token, "fresh");
    assert.equal(db.rows("accounts")[0].status, "connected");
  } finally { net.restore(); }
});

test("sync: revoked access (invalid_grant) surfaces as needs_reauth, not silence", async () => {
  const acct = seedAccount();
  db.rows("account_secrets")[0].tokens_enc = encrypt(JSON.stringify({ access_token: "old", refresh_token: "rt", expires_at: 0, scope: "x" }));
  const net = stubFetch((c) => c.url === "https://oauth2.googleapis.com/token"
    ? new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 }) : undefined);
  try {
    const res = await syncAccount(acct);
    assert.ok(res.error);
    assert.equal(db.rows("accounts")[0].status, "needs_reauth");
    assert.match(String(db.rows("accounts")[0].status_detail), /revoked/i);
  } finally { net.restore(); }
});

test("sync: other Gmail failures set status=error with detail", async () => {
  const acct = seedAccount();
  const net = stubFetch((c) => c.url.includes("/messages?") ? new Response("boom", { status: 500 }) : undefined);
  try {
    await syncAccount(acct);
    assert.equal(db.rows("accounts")[0].status, "error");
    assert.match(String(db.rows("accounts")[0].status_detail), /500/);
  } finally { net.restore(); }
});

test("/api/sync: auth rules (session, cron secret, neither)", async () => {
  seedAccount(A); seedAccount(B);
  const net = stubFetch((c) => c.url.includes("/messages?") ? { messages: [] } : undefined);
  const call = (headers: Record<string, string> = {}) => syncRoute.POST(new NextRequest("https://app.test/api/sync", { method: "POST", headers }));
  try {
    db.user = null;
    assert.equal((await call()).status, 401);
    assert.equal((await call({ authorization: "Bearer wrong" })).status, 401);
    assert.equal(net.calls.length, 0);

    const r = await call({ authorization: "Bearer cron-secret-for-tests" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).results.length, 2, "cron syncs all users");

    db.user = A;
    const mine = await (await call()).json();
    assert.equal(mine.results.length, 1, "a user only syncs their own accounts");
  } finally { net.restore(); }
});

// ---------- disconnect, cron, housekeeping ----------
import { cleanupExpired, disconnectAccount } from "../src/lib/accounts";
import * as register from "../src/app/api/oauth/register/route";

test("disconnect: owner only; revokes the Google grant; logs; deletes", async () => {
  const mine = seedAccount(A), theirs = seedAccount(B);
  const net = stubFetch((c) => c.url === "https://oauth2.googleapis.com/revoke" ? {} : undefined);
  try {
    assert.equal((await disconnectAccount(A.id, theirs)).ok, false, "cannot disconnect someone else's account");
    assert.equal(db.rows("accounts").length, 2);
    assert.equal(net.calls.length, 0);

    assert.equal((await disconnectAccount(A.id, mine)).ok, true);
    assert.deepEqual(db.rows("accounts").map((a) => a.id), [theirs]);
    assert.equal(net.calls.length, 1);
    assert.match(net.calls[0].body, /token=rt/);
    assert.ok(db.rows("audit_log").some((a) => a.action === "account.disconnected"));
  } finally { net.restore(); }
});

test("disconnect: still deletes if Google's revoke endpoint is down", async () => {
  const mine = seedAccount(A);
  const net = stubFetch(() => new Response("down", { status: 503 }));
  try {
    assert.equal((await disconnectAccount(A.id, mine)).ok, true);
    assert.equal(db.rows("accounts").length, 0);
  } finally { net.restore(); }
});

test("cron: GET needs the cron secret (a browser session is not enough); housekeeping keeps live tokens", async () => {
  seedAccount(A);
  const old = new Date(Date.now() - 3 * 86400_000).toISOString(), fresh = new Date(Date.now() + 3600_000).toISOString();
  db.rows("oauth_clients").push({ client_id: "c1", client_name: "x", redirect_uris: ["https://x/y"] });
  db.rows("oauth_codes").push({ code_hash: "old", client_id: "c1", user_id: A.id, expires_at: old }, { code_hash: "new", client_id: "c1", user_id: A.id, expires_at: fresh });
  db.rows("oauth_tokens").push({ token_hash: "old", kind: "access", client_id: "c1", user_id: A.id, expires_at: old }, { token_hash: "live", kind: "refresh", client_id: "c1", user_id: A.id, expires_at: fresh });
  const net = stubFetch((c) => c.url.includes("/messages?") ? { messages: [] } : undefined);
  try {
    db.user = A;
    assert.equal((await syncRoute.GET(new NextRequest("https://app.test/api/sync"))).status, 401);
    assert.equal((await syncRoute.GET(new NextRequest("https://app.test/api/sync", { headers: { authorization: "Bearer nope" } }))).status, 401);
    assert.equal(db.rows("oauth_codes").length, 2, "unauthenticated GET must not clean up");

    const r = await syncRoute.GET(new NextRequest("https://app.test/api/sync", { headers: { authorization: "Bearer cron-secret-for-tests" } }));
    assert.equal(r.status, 200);
    assert.deepEqual(db.rows("oauth_codes").map((c) => c.code_hash), ["new"]);
    assert.deepEqual(db.rows("oauth_tokens").map((t) => t.token_hash), ["live"]);
  } finally { net.restore(); }
  await cleanupExpired(); // idempotent
});

test("registration is rate-limited per hour", async () => {
  for (let i = 0; i < 100; i++) db.rows("oauth_clients").push({ client_id: `c${i}`, client_name: "x", redirect_uris: ["https://x/y"], created_at: new Date().toISOString() });
  const r = await register.POST(new NextRequest("https://app.test/api/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["https://claude.example/cb"] }), headers: { "content-type": "application/json" } }));
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "3600");
});

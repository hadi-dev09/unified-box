import { A, B, db, stubFetch } from "./setup";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as waHook from "../src/app/api/webhooks/whatsapp/route";
import * as waConnect from "../src/app/api/connect/whatsapp/route";
import * as tgConnect from "../src/app/api/connect/telegram/route";
import * as msStart from "../src/app/api/connect/outlook/route";
import * as msCallback from "../src/app/api/connect/outlook/callback/route";
import * as compose from "../src/app/api/compose/route";
import { decrypt, encrypt } from "../src/lib/crypto";
import { setTelegramFactory, type TgClient, type TgDialog } from "../src/lib/telegram";
import { syncAccount } from "../src/lib/sync";

const SECRET = "wa-app-secret";
process.env.WHATSAPP_APP_SECRET = SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
process.env.TELEGRAM_API_ID = "123";
process.env.TELEGRAM_API_HASH = "hash";
process.env.MICROSOFT_CLIENT_ID = "mid";
process.env.MICROSOFT_CLIENT_SECRET = "msecret";

beforeEach(() => db.reset());
afterEach(() => setTelegramFactory(undefined));

const json = (url: string, body: unknown, cookie?: string) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) } });
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? "").split(";")[0];

function seed(provider: string, over: Record<string, unknown> = {}, secret: unknown = { access_token: "tok" }, user = A) {
  const id = `acct-${Math.random().toString(36).slice(2)}`;
  db.rows("accounts").push({ id, user_id: user.id, provider, account_type: "company", display_name: provider, external_id: "111222333", status: "connected", can_send: true, ...over });
  db.rows("account_secrets").push({ account_id: id, tokens_enc: encrypt(JSON.stringify(secret)) });
  return id;
}

// ---------- WhatsApp webhook ----------
const waPayload = (pid = "111222333", text = "Hi, is the invoice ready?") => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { metadata: { phone_number_id: pid }, contacts: [{ wa_id: "923001234567", profile: { name: "Sara (Acme)" } }],
    messages: [
      { id: "wamid.1", from: "923001234567", timestamp: String(Math.floor(Date.now() / 1000) - 60), type: "text", text: { body: text } },
      { id: "wamid.2", from: "923001234567", timestamp: String(Math.floor(Date.now() / 1000)), type: "image", image: { caption: "screenshot" } },
    ] } }] }],
});
const signed = (body: unknown, secret = SECRET) => {
  const raw = JSON.stringify(body);
  return new NextRequest("https://app.test/api/webhooks/whatsapp", { method: "POST", body: raw, headers: { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` } });
};

test("whatsapp webhook: verification handshake only with the right token", async () => {
  const ok = await waHook.GET(new NextRequest("https://app.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"));
  assert.equal(ok.status, 200); assert.equal(await ok.text(), "42");
  assert.equal((await waHook.GET(new NextRequest("https://app.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42"))).status, 403);
  assert.equal((await waHook.GET(new NextRequest("https://app.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.challenge=42"))).status, 403);
});

test("whatsapp webhook: rejects unsigned / wrongly signed payloads and stores nothing", async () => {
  seed("whatsapp");
  const raw = JSON.stringify(waPayload());
  assert.equal((await waHook.POST(new NextRequest("https://app.test/api/webhooks/whatsapp", { method: "POST", body: raw }))).status, 401);
  assert.equal((await waHook.POST(signed(waPayload(), "not-the-secret"))).status, 401);
  assert.equal(db.rows("messages").length, 0);
});

test("whatsapp webhook: signed messages land as one unread conversation, media labelled, idempotent", async () => {
  seed("whatsapp");
  seed("whatsapp", { external_id: "999" }, undefined, B); // another business number must not receive it
  assert.equal((await waHook.POST(signed(waPayload()))).status, 200);
  assert.equal((await waHook.POST(signed(waPayload()))).status, 200); // Meta retries
  const threads = db.rows("threads");
  assert.equal(threads.length, 1);
  assert.equal(threads[0].user_id, A.id);
  assert.equal(threads[0].external_id, "923001234567");
  assert.equal(threads[0].subject, "Sara (Acme)");
  assert.equal(threads[0].unread, true);
  assert.equal(threads[0].needs_reply, true);
  assert.equal(db.rows("messages").length, 2);
  assert.match(String(db.rows("messages").find((m) => m.external_id === "wamid.2")!.body_text), /Photo: screenshot/);
});

test("whatsapp connect: validates input, verifies the number with Meta, stores the token encrypted", async () => {
  db.user = A;
  assert.equal((await waConnect.POST(json("https://app.test/api/connect/whatsapp", { phone_number_id: "abc", token: "x".repeat(30) }))).status, 400);
  assert.equal((await waConnect.POST(json("https://app.test/api/connect/whatsapp", { phone_number_id: "111222333", token: "short" }))).status, 400);
  const net = stubFetch((c) => {
    if (c.url.includes("/111222333?")) return { verified_name: "Acme Studio", display_phone_number: "+92 300 0000000" };
    if (c.url.endsWith("/555666777/subscribed_apps")) return { success: true };
  });
  try {
    const r = await waConnect.POST(json("https://app.test/api/connect/whatsapp", { phone_number_id: "111222333", waba_id: "555666777", token: "EAAG" + "x".repeat(40) }));
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    const acct = db.rows("accounts")[0];
    assert.equal(acct.provider, "whatsapp"); assert.equal(acct.can_send, true);
    const sec = db.rows("account_secrets")[0].tokens_enc as string;
    assert.ok(!sec.includes("EAAG"), "token is encrypted at rest");
    assert.equal(JSON.parse(decrypt(sec)).access_token.slice(0, 4), "EAAG");
  } finally { net.restore(); }
  db.user = null;
  assert.equal((await waConnect.POST(json("https://app.test/api/connect/whatsapp", {}))).status, 401);
});

test("whatsapp reply: sends to the customer and shows in the conversation immediately", async () => {
  const acct = seed("whatsapp");
  await waHook.POST(signed(waPayload()));
  const thread = db.rows("threads")[0];
  db.user = A;
  const net = stubFetch((c) => c.url.endsWith("/111222333/messages") ? { messages: [{ id: "wamid.out1" }] } : undefined);
  try {
    const r = await compose.POST(json("https://app.test/api/compose", { thread_id: thread.id, body: "Yes, sending it today.", send: true }));
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    const sent = JSON.parse(net.calls[0].body);
    assert.equal(sent.to, "923001234567"); assert.equal(sent.text.body, "Yes, sending it today.");
    const out = db.rows("messages").find((m) => m.external_id === "wamid.out1")!;
    assert.equal(out.is_outgoing, true); assert.equal(out.account_id, acct);
    const t = db.rows("threads")[0];
    assert.equal(t.unread, false); assert.equal(t.last_from, "You"); assert.equal(t.needs_reply, false);
  } finally { net.restore(); }
});

test("whatsapp reply: a closed 24h window gives a clear error and marks nothing as sent", async () => {
  seed("whatsapp");
  await waHook.POST(signed(waPayload()));
  db.user = A;
  const net = stubFetch(() => new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 }));
  try {
    const r = await compose.POST(json("https://app.test/api/compose", { thread_id: db.rows("threads")[0].id, body: "hello", send: true }));
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /24 hours/);
    assert.equal(db.rows("drafts")[0].status, "failed");
  } finally { net.restore(); }
});

// ---------- Telegram ----------
function fakeTelegram(opts: { needsPassword?: boolean; badCode?: boolean } = {}) {
  const log: string[] = [];
  const dialogs: TgDialog[] = [
    { id: "777", title: "Omar (Client)", unreadCount: 2, isUser: true, isGroup: false, isChannel: false, entity: {}, date: Math.floor(Date.now() / 1000) },
    { id: "888", title: "News channel", unreadCount: 9, isUser: false, isGroup: false, isChannel: true, entity: {}, date: Math.floor(Date.now() / 1000) },
  ];
  setTelegramFactory(async (session) => {
    let authed = session.includes("authed");
    const c: TgClient = {
      connect: async () => { log.push("connect"); }, disconnect: async () => { log.push("disconnect"); },
      saveSession: () => (authed ? "sess-authed" : "sess-pending"),
      sendCode: async (phone) => { log.push(`code:${phone}`); return { phoneCodeHash: "h1" }; },
      signIn: async (_p, hash, code) => {
        assert.equal(hash, "h1");
        if (opts.badCode && code !== "99999") throw new Error("PHONE_CODE_INVALID");
        if (opts.needsPassword) return "password";
        authed = true; return "ok";
      },
      checkPassword: async (pw) => { if (pw !== "hunter2") throw new Error("PASSWORD_HASH_INVALID"); authed = true; },
      me: async () => ({ id: "42", name: "Rafay", username: "rafay" }),
      dialogs: async () => dialogs,
      messages: async (d) => d.id === "777" ? [
        { id: 1, text: "Can we move the call?", date: Math.floor(Date.now() / 1000) - 100, out: false, senderId: "777", senderName: "Omar" },
        { id: 2, text: "Also, see the brief", date: Math.floor(Date.now() / 1000) - 50, out: false, senderId: "777", senderName: "Omar" },
      ] : [{ id: 1, text: "breaking news", date: Math.floor(Date.now() / 1000), out: false, senderId: "888", senderName: "" }],
      send: async (d, text) => { log.push(`send:${d.id}:${text}`); return { id: 3, date: Math.floor(Date.now() / 1000) }; },
      logOut: async () => { log.push("logout"); },
    };
    return c;
  });
  return log;
}
const tg = (body: unknown, cookie?: string) => tgConnect.POST(json("https://app.test/api/connect/telegram", body, cookie));

test("telegram: phone -> code signs in, stores an encrypted session, syncs chats but not channels", async () => {
  const log = fakeTelegram();
  db.user = A;
  assert.equal((await tg({ action: "start", phone: "12" })).status, 400);
  const s1 = await tg({ action: "start", phone: "+92 300 1234567" });
  assert.equal((await s1.json()).step, "code");
  assert.ok(log.includes("code:+923001234567"));
  const cookie = cookieOf(s1, "tg_login");
  assert.ok(cookie && !cookie.includes("h1"), "pending login is encrypted");
  const s2 = await tg({ action: "code", code: "12345" }, cookie);
  assert.equal(s2.status, 200, JSON.stringify(await s2.clone().json()));
  assert.equal((await s2.json()).step, "done");
  const acct = db.rows("accounts")[0];
  assert.equal(acct.provider, "telegram"); assert.equal(acct.display_name, "@rafay"); assert.equal(acct.external_id, "42");
  assert.equal(JSON.parse(decrypt(db.rows("account_secrets")[0].tokens_enc as string)).session, "sess-authed");
  const threads = db.rows("threads");
  assert.equal(threads.length, 1, "broadcast channels are skipped");
  assert.equal(threads[0].subject, "Omar (Client)"); assert.equal(threads[0].unread, true);
});

test("telegram: wrong code, then two-step password (wrong then right)", async () => {
  fakeTelegram({ needsPassword: true, badCode: true });
  db.user = A;
  const cookie = cookieOf(await tg({ action: "start", phone: "+923001234567" }), "tg_login");
  const bad = await tg({ action: "code", code: "11111" }, cookie);
  assert.match((await bad.json()).error, /incorrect/);
  const s2 = await tg({ action: "code", code: "99999" }, cookie);
  assert.equal((await s2.json()).step, "password");
  const cookie2 = cookieOf(s2, "tg_login");
  assert.match((await (await tg({ action: "password", password: "nope" }, cookie2)).json()).error, /Wrong two-step/);
  assert.equal((await (await tg({ action: "password", password: "hunter2" }, cookie2)).json()).step, "done");
  assert.equal(db.rows("accounts").length, 1);
});

test("telegram: another user's pending login cookie is ignored", async () => {
  fakeTelegram();
  db.user = A;
  const cookie = cookieOf(await tg({ action: "start", phone: "+923001234567" }), "tg_login");
  db.user = B;
  assert.match((await (await tg({ action: "code", code: "12345" }, cookie)).json()).error, /expired/);
  assert.equal(db.rows("accounts").length, 0);
});

test("telegram: reply goes into the same chat", async () => {
  const log = fakeTelegram();
  const acct = seed("telegram", { external_id: "42", account_type: "personal" }, { session: "sess-authed" });
  await syncAccount(acct);
  db.user = A;
  const t = db.rows("threads")[0];
  const r = await compose.POST(json("https://app.test/api/compose", { thread_id: t.id, body: "Sure, 4pm works", send: true }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.ok(log.includes("send:777:Sure, 4pm works"));
  assert.ok(db.rows("messages").some((m) => m.external_id === "777:3" && m.is_outgoing));
  assert.equal(db.rows("threads")[0].unread, false);
});

// ---------- Outlook ----------
test("outlook: start redirects to Microsoft with state cookie; callback stores account and syncs", async () => {
  db.user = A;
  const start = await msStart.GET(new NextRequest("https://app.test/api/connect/outlook?type=company&write=1"));
  const loc = new URL(start.headers.get("location")!);
  assert.equal(loc.hostname, "login.microsoftonline.com");
  assert.match(loc.searchParams.get("scope")!, /Mail\.Send/);
  const state = loc.searchParams.get("state")!;
  const cookie = cookieOf(start, "ms_oauth");

  const now = new Date().toISOString();
  const net = stubFetch((c) => {
    if (c.url.endsWith("/oauth2/v2.0/token")) return { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "Mail.Read Mail.Send User.Read" };
    if (c.url.includes("/v1.0/me?")) return { mail: "me@contoso.com", displayName: "Me", userPrincipalName: "me@contoso.com" };
    if (c.url.includes("/me/messages")) return { value: [{ id: "m1", conversationId: "conv1", subject: "Proposal", bodyPreview: "Hi", body: { content: "Hi there" }, from: { emailAddress: { name: "Jo", address: "jo@client.com" } }, toRecipients: [{ emailAddress: { address: "me@contoso.com" } }], ccRecipients: [], receivedDateTime: now, sentDateTime: now, isRead: false, parentFolderId: "inbox", internetMessageId: "<a@b>", inferenceClassification: "focused" }] };
  });
  try {
    const bad = await msCallback.GET(new NextRequest(`https://app.test/api/connect/outlook/callback?code=c&state=forged`, { headers: { cookie } }));
    assert.match(decodeURIComponent(bad.headers.get("location")!), /Invalid connection/);
    const r = await msCallback.GET(new NextRequest(`https://app.test/api/connect/outlook/callback?code=c&state=${state}`, { headers: { cookie } }));
    assert.match(decodeURIComponent(r.headers.get("location")!), /Connected me@contoso.com/);
    const acct = db.rows("accounts")[0];
    assert.equal(acct.provider, "outlook"); assert.equal(acct.can_send, true); assert.equal(acct.account_type, "company");
    assert.equal(db.rows("threads").length, 1);
    assert.equal(db.rows("threads")[0].unread, true);
  } finally { net.restore(); }
});

test("outlook: admin-consent refusal shows a helpful message", async () => {
  db.user = A;
  const start = await msStart.GET(new NextRequest("https://app.test/api/connect/outlook?type=company"));
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const r = await msCallback.GET(new NextRequest(`https://app.test/api/connect/outlook/callback?error=access_denied&error_description=AADSTS65001&state=${state}`, { headers: { cookie: cookieOf(start, "ms_oauth") } }));
  assert.match(decodeURIComponent(r.headers.get("location")!), /IT admin/);
  assert.equal(db.rows("accounts").length, 0);
});

test("compose: Slack stays read-only; chat replies need text; email needs recipients", async () => {
  db.user = A;
  const slack = seed("slack", { external_id: "T1:U1" });
  db.rows("threads").push({ id: "t-slack", user_id: A.id, account_id: slack, external_id: "C1", subject: "#general" });
  assert.match((await (await compose.POST(json("https://app.test/api/compose", { thread_id: "t-slack", body: "hi", send: true }))).json()).error, /isn't available for Slack/);
  const wa = seed("whatsapp");
  db.rows("threads").push({ id: "t-wa", user_id: A.id, account_id: wa, external_id: "923", subject: "Sara" });
  assert.match((await (await compose.POST(json("https://app.test/api/compose", { thread_id: "t-wa", body: "   ", send: true }))).json()).error, /Write a message/);
  assert.equal((await compose.POST(json("https://app.test/api/compose", { thread_id: "t-wa", body: "x".repeat(5000), send: true }))).status, 400);
  db.rows("threads").push({ id: "t-other", user_id: B.id, account_id: wa, external_id: "924", subject: "x" });
  assert.equal((await compose.POST(json("https://app.test/api/compose", { thread_id: "t-other", body: "hi", send: true }))).status, 404);
});

test("MCP draft_reply: AI can draft into a WhatsApp chat, nothing is sent until the human approves", async () => {
  const { tools } = await import("../src/lib/mcp-tools");
  const draft = tools.find((t) => t.name === "draft_reply")!;
  seed("whatsapp");
  await waHook.POST(signed(waPayload()));
  const tid = db.rows("threads")[0].id as string;
  const net = stubFetch(() => undefined); // any network call would throw
  try {
    const r = (await draft.run(A.id, { thread_id: tid, body: "Invoice attached shortly." } as never)) as { status: string; draft_id: string };
    assert.equal(r.status, "pending");
    assert.equal(net.calls.length, 0, "AI drafting never sends");
    const d = db.rows("drafts")[0];
    assert.equal(d.created_by, "claude"); assert.deepEqual(d.to_addrs, []);
    // another user can't draft into it
    assert.match(String(((await draft.run(B.id, { thread_id: tid, body: "x" } as never)) as { error: string }).error), /not found/);
  } finally { net.restore(); }
});

test("telegram: code requests are rate-limited per user (no SMS/code spamming)", async () => {
  const log = fakeTelegram();
  db.user = A;
  for (let i = 0; i < 5; i++) assert.equal((await tg({ action: "start", phone: "+923001234567" })).status, 200);
  const r = await tg({ action: "start", phone: "+923001234567" });
  assert.equal(r.status, 429);
  assert.equal(log.filter((l) => l.startsWith("code:")).length, 5);
  db.user = B;
  assert.equal((await tg({ action: "start", phone: "+923001234567" })).status, 200, "other users unaffected");
});

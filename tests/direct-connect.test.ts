import { A, B, db, stubFetch } from "./setup";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as waConnect from "../src/app/api/connect/whatsapp-web/route";
import * as waHook from "../src/app/api/webhooks/wa-gateway/route";
import * as imapConnect from "../src/app/api/connect/imap/route";
import * as compose from "../src/app/api/compose/route";
import { encrypt } from "../src/lib/crypto";
import { disconnectAccount } from "../src/lib/accounts";
import { credsFor, safeServer, setMailFactories, type ImapCreds } from "../src/lib/imap";
import { syncAccount } from "../src/lib/sync";

const SECRET = "gw-webhook-secret";
process.env.WA_GATEWAY_URL = "https://wa.test";
process.env.WA_GATEWAY_KEY = "gw-key";
process.env.WA_GATEWAY_WEBHOOK_SECRET = SECRET;

beforeEach(() => db.reset());
afterEach(() => setMailFactories(undefined, undefined));
const post = (url: string, body: unknown, cookie?: string) => new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) } });
const get = (url: string, cookie?: string) => new NextRequest(url, { headers: cookie ? { cookie } : {} });
const cookieOf = (r: Response) => (r.headers.getSetCookie().find((c) => c.startsWith("wa_link=")) ?? "").split(";")[0];
const signed = (body: unknown, secret = SECRET) => {
  const raw = JSON.stringify(body);
  return new NextRequest("https://app.test/api/webhooks/wa-gateway", { method: "POST", body: raw, headers: { "x-webhook-hmac": createHmac("sha512", secret).update(raw).digest("hex"), "x-webhook-hmac-algorithm": "sha512" } });
};

// ---------- WhatsApp (scan QR) via gateway ----------
test("whatsapp QR: start creates a gateway session wired to our signed webhook; QR then WORKING links the account", async () => {
  db.user = null;
  assert.equal((await waConnect.POST(post("https://app.test/api/connect/whatsapp-web", { action: "start" }))).status, 401);
  db.user = A;
  let status = "SCAN_QR_CODE";
  const net = stubFetch((c) => {
    assert.ok(c.url.startsWith("https://wa.test/"), c.url);
    if (c.url === "https://wa.test/api/sessions" && c.method === "POST") return { name: "x", status: "STARTING" };
    if (/\/api\/sessions\/ub[a-f0-9]{20}$/.test(c.url)) return status === "WORKING" ? { status, me: { id: "923001234567@c.us", pushName: "Rafay" } } : { status };
    if (/\/auth\/qr\?format=image$/.test(c.url)) return { mimetype: "image/png", data: "iVBORw0KGgo=" };
  });
  try {
    const s = await waConnect.POST(post("https://app.test/api/connect/whatsapp-web", { action: "start" }));
    assert.equal(s.status, 200);
    const created = JSON.parse(net.calls[0].body);
    assert.match(created.name, /^ub[a-f0-9]{20}$/);
    assert.equal(created.start, true);
    assert.equal(created.config.webhooks[0].url, "https://app.test/api/webhooks/wa-gateway");
    assert.equal(created.config.webhooks[0].hmac.key, SECRET);
    const cookie = cookieOf(s);
    assert.ok(cookie && !cookie.includes(created.name), "pending link is encrypted");
    const q = await (await waConnect.GET(get("https://app.test/api/connect/whatsapp-web", cookie))).json();
    assert.equal(q.status, "SCAN_QR_CODE"); assert.equal(q.qr, "data:image/png;base64,iVBORw0KGgo=");
    // another user can't use this pending link
    db.user = B;
    assert.equal((await waConnect.GET(get("https://app.test/api/connect/whatsapp-web", cookie))).status, 410);
    db.user = A;
    status = "WORKING";
    const done = await (await waConnect.GET(get("https://app.test/api/connect/whatsapp-web", cookie))).json();
    assert.equal(done.connected, "Rafay · +923001234567");
    const acct = db.rows("accounts")[0];
    assert.equal(acct.provider, "whatsapp_web"); assert.equal(acct.external_id, created.name); assert.equal(acct.can_send, true);
  } finally { net.restore(); }
});

test("whatsapp QR: passkey-locked phones get a clear message; pairing code needs a valid number", async () => {
  db.user = A;
  const net = stubFetch((c) => (c.url === "https://wa.test/api/sessions" ? {} : /request-code$/.test(c.url) ? { code: "ABCD-1234" } : { status: "PASSKEY_REQUIRED" }));
  try {
    const cookie = cookieOf(await waConnect.POST(post("https://app.test/api/connect/whatsapp-web", { action: "start" })));
    assert.equal((await waConnect.POST(post("https://app.test/api/connect/whatsapp-web", { action: "code", phone: "12" }, cookie))).status, 400);
    assert.equal((await (await waConnect.POST(post("https://app.test/api/connect/whatsapp-web", { action: "code", phone: "+92 300 1234567" }, cookie))).json()).code, "ABCD-1234");
    assert.match(String(JSON.parse(net.calls.at(-1)!.body).phoneNumber), /^923001234567$/);
    const r = await (await waConnect.GET(get("https://app.test/api/connect/whatsapp-web", cookie))).json();
    assert.equal(r.status, "PASSKEY_REQUIRED"); assert.match(r.message, /passkey/);
    assert.equal(db.rows("accounts").length, 0);
  } finally { net.restore(); }
});

const SESSION = "ub0123456789abcdef0123";
function seedWa(user = A) {
  db.rows("accounts").push({ id: "wa1", user_id: user.id, provider: "whatsapp_web", display_name: "+923001234567", external_id: SESSION, status: "connected", can_send: true });
}
const msgEvent = (over: Record<string, unknown> = {}) => ({
  id: "evt_1", timestamp: Date.now(), session: SESSION, engine: "GOWS", event: "message.any",
  payload: { id: "false_923331112222@c.us_ABC", timestamp: Math.floor(Date.now() / 1000), from: "923331112222@c.us", to: "923001234567@c.us", fromMe: false, body: "Is the design ready?", hasMedia: false, _data: { Info: { PushName: "Ali (Client)" } }, ...over },
});

test("whatsapp QR webhook: signature required; messages become unread conversations; status changes flag the account", async () => {
  seedWa();
  assert.equal((await waHook.POST(signed(msgEvent(), "wrong"))).status, 401);
  assert.equal((await waHook.POST(new NextRequest("https://app.test/api/webhooks/wa-gateway", { method: "POST", body: JSON.stringify(msgEvent()) }))).status, 401);
  assert.equal(db.rows("threads").length, 0);
  assert.equal((await waHook.POST(signed(msgEvent()))).status, 200);
  assert.equal((await waHook.POST(signed(msgEvent()))).status, 200); // retries are idempotent
  const t = db.rows("threads")[0];
  assert.equal(t.external_id, "923331112222@c.us"); assert.equal(t.subject, "Ali (Client)"); assert.equal(t.unread, true); assert.equal(t.needs_reply, true);
  assert.equal(db.rows("messages").length, 1);
  // my own message sent from the phone
  await waHook.POST(signed(msgEvent({ id: "true_923331112222@c.us_DEF", fromMe: true, from: "923001234567@c.us", to: "923331112222@c.us", body: "Yes, sending now" })));
  const t2 = db.rows("threads")[0];
  assert.equal(t2.unread, false); assert.equal(t2.last_from, "You");
  // photo with no caption, status broadcasts and unknown sessions are handled
  await waHook.POST(signed(msgEvent({ id: "m3", body: "", hasMedia: true, _data: { Message: { imageMessage: {} }, Info: { PushName: "Ali (Client)" } } })));
  assert.ok(db.rows("messages").some((m) => m.body_text === "📷 Photo"));
  await waHook.POST(signed(msgEvent({ id: "m4", from: "status@broadcast" })));
  await waHook.POST(signed({ ...msgEvent(), session: "ub" + "f".repeat(20) }));
  assert.equal(db.rows("threads").length, 1);
  await waHook.POST(signed({ id: "e", timestamp: 1, session: SESSION, event: "session.status", payload: { status: "FAILED" } }));
  assert.equal(db.rows("accounts")[0].status, "needs_reauth");
});

test("whatsapp QR: replies go out through the gateway on the right session; disconnect unlinks the phone", async () => {
  seedWa();
  await waHook.POST(signed(msgEvent()));
  db.user = A;
  const net = stubFetch((c) => (c.url === "https://wa.test/api/sendText" ? { id: "true_923331112222@c.us_OUT1" } : c.url.includes("/logout") || c.method === "DELETE" ? {} : undefined));
  try {
    const r = await compose.POST(post("https://app.test/api/compose", { thread_id: db.rows("threads")[0].id, body: "Ready by 5pm", send: true }));
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    const sent = JSON.parse(net.calls[0].body);
    assert.deepEqual([sent.session, sent.chatId, sent.text], [SESSION, "923331112222@c.us", "Ready by 5pm"]);
    assert.equal(net.calls[0].url, "https://wa.test/api/sendText");
    assert.ok(db.rows("messages").some((m) => m.external_id === "true_923331112222@c.us_OUT1" && m.is_outgoing));
    await disconnectAccount(A.id, "wa1");
    assert.ok(net.calls.some((c) => c.url.endsWith(`/api/sessions/${SESSION}/logout`)));
    assert.equal(db.rows("accounts").length, 0);
  } finally { net.restore(); }
});

// ---------- Email with app password (IMAP/SMTP) ----------
test("imap: custom servers must be public and on mail ports", async () => {
  assert.match(String(await safeServer({ host: "localhost", port: 993, secure: true })), /valid mail server/);
  assert.match(String(await safeServer({ host: "127.0.0.1", port: 993, secure: true })), /isn't reachable/);
  assert.match(String(await safeServer({ host: "10.1.2.3", port: 993, secure: true })), /isn't reachable/);
  assert.match(String(await safeServer({ host: "imap.example.com", port: 22, secure: true })), /standard mail port/);
  assert.equal(credsFor("custom", "a@b.co", "p", {}), null);
  assert.equal(credsFor("gmail", "a@b.co", "p")!.imap.host, "imap.gmail.com");
});

const RAW = (id: string, from: string, subject: string, body: string, extra = "") =>
  Buffer.from(`From: ${from}\r\nTo: me@mail.test\r\nSubject: ${subject}\r\nMessage-ID: <${id}@mail.test>\r\nDate: ${new Date().toUTCString()}\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`);
function fakeMail(opts: { failLogin?: boolean } = {}) {
  const log: string[] = [];
  const boxes: Record<number, { raw: Buffer; seen: boolean; thread?: string }> = {
    11: { raw: RAW("a1", "Jo Client <jo@client.com>", "Invoice", "Can you send the invoice?"), seen: false },
    12: { raw: RAW("a2", "Jo Client <jo@client.com>", "Re: Invoice", "Also the receipt please", "In-Reply-To: <a1@mail.test>\r\nReferences: <a1@mail.test>\r\n"), seen: true },
    13: { raw: RAW("n1", "News <news@shop.com>", "Sale", "50% off", "List-Unsubscribe: <mailto:u@shop.com>\r\n"), seen: true },
  };
  const imap = () => ({
    connect: async () => { log.push("connect"); if (opts.failLogin) throw Object.assign(new Error("Command failed"), { responseText: "Invalid credentials (Failure)" }); },
    logout: async () => { log.push("logout"); },
    getMailboxLock: async (_b: string, o: { readOnly?: boolean }) => { log.push(`lock:${o?.readOnly}`); return { release: () => log.push("release") }; },
    search: async () => Object.keys(boxes).map(Number),
    fetch: async function* (range: string) { for (const u of range.split(",").map(Number)) yield { uid: u, flags: new Set(boxes[u].seen ? ["\\Seen"] : []), threadId: boxes[u].thread }; },
    fetchOne: async (uid: string) => ({ uid: Number(uid), source: boxes[Number(uid)].raw }),
  });
  const smtp = () => ({ verify: async () => true, sendMail: async (m: Record<string, unknown>) => { log.push(`send:${JSON.stringify(m)}`); return { messageId: "<sent1@mail.test>" }; } });
  setMailFactories(imap as never, smtp as never);
  return log;
}

test("imap: connect checks the login, stores it encrypted, syncs the inbox read-only and groups replies", async () => {
  db.user = A;
  assert.equal((await imapConnect.POST(post("https://app.test/api/connect/imap", { preset: "nope", email: "me@mail.test", password: "x" }))).status, 400);
  fakeMail({ failLogin: true });
  const bad = await imapConnect.POST(post("https://app.test/api/connect/imap", { preset: "gmail", email: "me@mail.test", password: "abcd efgh ijkl mnop" }));
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /app password/);
  const log = fakeMail();
  const r = await imapConnect.POST(post("https://app.test/api/connect/imap", { preset: "gmail", email: "Me@Mail.test", password: "abcd efgh ijkl mnop" }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const acct = db.rows("accounts")[0];
  assert.equal(acct.provider, "imap"); assert.equal(acct.external_id, "me@mail.test");
  const sec = String(db.rows("account_secrets")[0].tokens_enc);
  assert.ok(!sec.includes("abcdefgh"), "app password encrypted at rest");
  assert.ok(log.includes("lock:true"), "inbox opened read-only (syncing never marks mail as read)");
  const threads = db.rows("threads");
  assert.equal(threads.length, 2, "the reply joins its original conversation");
  const inv = threads.find((t) => /Invoice/.test(String(t.subject)))!;
  assert.equal(inv.unread, true);
  assert.equal(db.rows("messages").filter((m) => m.thread_id === inv.id).length, 2);
  assert.equal(threads.find((t) => t.subject === "Sale")!.needs_reply, false, "newsletters don't need a reply");
  // a second sync downloads nothing new
  const before = log.filter((l) => l === "connect").length;
  await syncAccount(acct.id as string);
  assert.equal(db.rows("messages").length, 3);
  assert.ok(log.filter((l) => l === "connect").length > before);
});

test("imap: reply goes out over SMTP, threaded, and appears in the conversation", async () => {
  const log = fakeMail();
  db.rows("accounts").push({ id: "im1", user_id: A.id, provider: "imap", display_name: "me@mail.test", external_id: "me@mail.test", status: "connected", can_send: true });
  const creds: ImapCreds = credsFor("gmail", "me@mail.test", "pw")!;
  db.rows("account_secrets").push({ account_id: "im1", tokens_enc: encrypt(JSON.stringify(creds)) });
  await syncAccount("im1");
  const t = db.rows("threads").find((x) => /Invoice/.test(String(x.subject)))!;
  db.user = A;
  const r = await compose.POST(post("https://app.test/api/compose", { thread_id: t.id, mode: "reply", to: ["jo@client.com"], subject: "Re: Invoice", body: "Attached!", send: true }));
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  const sent = JSON.parse(log.find((l) => l.startsWith("send:"))!.slice(5));
  assert.equal(sent.to, "jo@client.com"); assert.equal(sent.inReplyTo, "<a2@mail.test>"); assert.match(sent.references, /<a1@mail.test> <a2@mail.test>/);
  assert.ok(db.rows("messages").some((m) => m.thread_id === t.id && m.is_outgoing && m.body_text === "Attached!"));
  assert.equal(db.rows("threads").find((x) => x.id === t.id)!.unread, false);
});

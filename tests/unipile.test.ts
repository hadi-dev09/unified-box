import { A, B, db } from "./setup";
import { stubFetch } from "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.UNIPILE_API_KEY = "uk";
const U = "https://api.unipile.com/v2";
const recent = () => new Date(Date.now() - 60_000).toISOString();

test("unipile v2: auth link carries a signed state; forged or unsigned states are refused", async () => {
  const { hostedConnectLink, connectState, readState } = await import("../src/lib/unipile");
  const net = stubFetch((c) => (c.url === `${U}/auth/link` ? { object: "HostedAuthLink", link: "https://auth.unipile.com/abc" } : undefined));
  try {
    assert.equal(await hostedConnectLink(A.id, "gmail"), "https://auth.unipile.com/abc");
    const body = JSON.parse(net.calls[0].body);
    assert.deepEqual(body.providers, ["google"]);
    assert.equal(body.redirect_uri, "https://app.test/api/connect/hosted/done");
    assert.deepEqual(readState(body.state), { userId: A.id, provider: "gmail" });
  } finally { net.restore(); }
  assert.equal(readState(connectState(A.id, "gmail").replace(A.id, B.id)), null);
  assert.equal(readState(`${A.id}.gmail`), null);
});

test("unipile v2: coming back from the sign-in page adds the account for the right user, then email syncs", async () => {
  const { connectState } = await import("../src/lib/unipile");
  const done = await import("../src/app/api/connect/hosted/done/route");
  const { syncAccount } = await import("../src/lib/sync");
  const net = stubFetch((c) => {
    if (c.url === `${U}/accounts/acc_g1`) return { object: "Account", id: "acc_g1", provider: "google", name: "sam@gmail.com", created_at: recent(), status: "running" };
    if (c.url === `${U}/accounts/acc_old`) return { object: "Account", id: "acc_old", provider: "google", name: "victim@gmail.com", created_at: "2025-01-01T00:00:00.000Z" };
    if (c.url === `${U}/webhooks/endpoints/`) return c.method === "POST" ? { object: "WebhookEndpoint", id: "we_1" } : { data: [] };
    if (c.url.startsWith(`${U}/acc_g1/emails?`)) return { data: [
      { object: "Email", id: "e1", thread_id: "th1", subject: "Invoice", body_plain: "Please pay", date: "2026-11-20T10:00:00.000Z", is_unread: true, folders: ["INBOX"], message_id: "<m1@x>", from: [{ display_name: "Dana", email: "dana@client.com" }], to: [{ email: "sam@gmail.com" }] },
      { object: "Email", id: "e2", thread_id: "th1", subject: "Re: Invoice", body: "<p>Paid!</p>", date: "2026-11-20T11:00:00.000Z", is_unread: false, folders: ["SENT"], from: [{ email: "sam@gmail.com" }], to: [{ email: "dana@client.com" }] },
      { object: "Email", id: "e3", thread_id: "th9", subject: "spam", body_plain: "x", date: "2026-11-20T09:00:00.000Z", is_unread: true, folders: ["SPAM"], from: [{ email: "x@y.com" }] },
    ] };
    return undefined;
  });
  try {
    const res = await done.GET(new NextRequest(`https://app.test/api/connect/hosted/done?account_id=acc_g1&provider=google&state=${encodeURIComponent(connectState(A.id, "gmail"))}`));
    assert.equal(res.headers.get("location"), "https://app.test/settings?connecting=gmail");
    const acct = db.rows("accounts").find((a) => a.remote_id === "acc_g1")!;
    assert.equal(acct.user_id, A.id); assert.equal(acct.provider, "gmail"); assert.equal(acct.external_id, "sam@gmail.com");
    assert.ok(JSON.parse(net.calls.find((c) => c.url === `${U}/webhooks/endpoints/` && c.method === "POST")!.body).url.includes("/api/webhooks/unipile?k="));
    const r = await syncAccount(acct.id as string);
    assert.equal(r.synced, 2, "spam skipped");
    const t = db.rows("threads").find((x) => x.account_id === acct.id && x.external_id === "th1")!;
    assert.equal(t.unread, false, "you replied last");
    assert.equal(db.rows("messages").find((m) => m.external_id === "e2")!.body_text, "Paid!");
    // Someone else's old account id pasted into the return link is refused.
    const steal = await done.GET(new NextRequest(`https://app.test/api/connect/hosted/done?account_id=acc_old&state=${encodeURIComponent(connectState(B.id, "gmail"))}`));
    assert.match(decodeURIComponent(steal.headers.get("location")!), /couldn't be verified/);
    assert.equal(db.rows("accounts").filter((a) => a.remote_id === "acc_old").length, 0);
    // An account already owned by A can't be claimed by B.
    const claim = await done.GET(new NextRequest(`https://app.test/api/connect/hosted/done?account_id=acc_g1&state=${encodeURIComponent(connectState(B.id, "gmail"))}`));
    assert.match(decodeURIComponent(claim.headers.get("location")!), /couldn't be verified/);
  } finally { net.restore(); }
});

test("unipile v2: WhatsApp chats sync with names and unread; replies and read state go back to WhatsApp", async () => {
  const { syncAccount } = await import("../src/lib/sync");
  const { applyThreadAction } = await import("../src/lib/thread-actions");
  const { decideDraft } = await import("../src/lib/send");
  db.rows("accounts").push({ id: "w1", user_id: A.id, provider: "whatsapp_web", display_name: "+923001112222", external_id: "+923001112222", remote_id: "acc_w1", status: "connected", can_send: true });
  let net = stubFetch((c) => {
    if (c.url.startsWith(`${U}/acc_w1/chats?`)) return { data: [{ object: "Chat", id: "c1", name: "Ali Khan", last_message_timestamp: new Date().toISOString(), unread_count: 1, is_archived: false }] };
    if (c.url.startsWith(`${U}/acc_w1/chats/c1/messages`)) return { data: [
      { object: "Message", id: "m1", text: "Hi, are you free?", sender_id: "u2", sender: { display_name: "Ali Khan" }, is_sender: false, timestamp: "2026-11-20T11:59:00.000Z", is_event: false, is_hidden: false, is_deleted: false },
      { object: "Message", id: "m0", text: "Hello", sender_id: "me", is_sender: true, timestamp: "2026-11-20T11:58:00.000Z", is_event: false, is_hidden: false, is_deleted: false },
    ] };
    return undefined;
  });
  try { await syncAccount("w1"); } finally { net.restore(); }
  const t = db.rows("threads").find((x) => x.account_id === "w1")!;
  assert.equal(t.subject, "Ali Khan"); assert.equal(t.unread, true);
  assert.equal(db.rows("messages").filter((m) => m.thread_id === t.id).length, 2);

  net = stubFetch((c) => (c.url === `${U}/acc_w1/chats/c1` && c.method === "PATCH" ? { object: "ChatUpdated" } : undefined));
  try {
    const r = await applyThreadAction(A.id, [t.id as string], "read");
    assert.equal(r.mirrored, 1);
    assert.deepEqual(JSON.parse(net.calls[0].body), { read_status: true });
  } finally { net.restore(); }

  db.rows("drafts").push({ id: "dw1", user_id: A.id, account_id: "w1", thread_id: t.id, to_addrs: [], cc_addrs: [], subject: "", body: "Yes, 5pm works", status: "pending", created_by: "user", mode: "reply" });
  net = stubFetch((c) => (c.url === `${U}/acc_w1/chats/c1/messages/send` ? { object: "MessageSent", message_id: "m9" } : undefined));
  try {
    const r = await decideDraft(A.id, "dw1", "approve");
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(net.calls[0].body), { text: "Yes, 5pm works" });
    assert.ok(db.rows("messages").some((m) => m.external_id === "c1:m9" && m.is_outgoing));
  } finally { net.restore(); }
});

test("unipile v2: webhook needs our key, finds the account anywhere in the payload, and marks disconnects", async () => {
  const { webhookKey, payloadAccountId } = await import("../src/lib/unipile");
  const hook = await import("../src/app/api/webhooks/unipile/route");
  assert.equal(payloadAccountId({ event: "message.new", data: { account: { id: "acc_w1" }, chat_id: "c1" } }), "acc_w1");
  assert.equal(payloadAccountId({ account_id: "acc_x" }), "acc_x");
  assert.equal(payloadAccountId({ data: { id: "acc_nope" } }), null);
  const no = await hook.POST(new NextRequest("https://app.test/api/webhooks/unipile", { method: "POST", body: JSON.stringify({ account_id: "acc_w1" }) }));
  assert.equal(no.status, 401);
  // A short drop that Unipile already recovered from doesn't ask the person to reconnect...
  let up = "running";
  const net = stubFetch((c) => (c.url === "https://api.unipile.com/v2/accounts/acc_w1" ? { object: "Account", id: "acc_w1", provider: "whatsapp", status: up } : undefined));
  try {
    const blip = await hook.POST(new NextRequest(`https://app.test/api/webhooks/unipile?k=${webhookKey()}`, { method: "POST", body: JSON.stringify({ event: "account.status.disconnected", account_id: "acc_w1" }) }));
    assert.equal(blip.status, 200);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(db.rows("accounts").find((a) => a.id === "w1")!.status, "connected");
    // ...a real disconnect does.
    up = "disconnected";
    await hook.POST(new NextRequest(`https://app.test/api/webhooks/unipile?k=${webhookKey()}`, { method: "POST", body: JSON.stringify({ event: "account.status.disconnected", account_id: "acc_w1" }) }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(db.rows("accounts").find((a) => a.id === "w1")!.status, "needs_reauth");
    assert.ok(db.rows("sync_events").some((e) => e.kind === "webhook" && e.detail === "account.status.disconnected"));
  } finally { net.restore(); }
});

test("unipile v2: chats without a time are still re-read, phone reads clear unread, and a pushed message fetches just its chat", async () => {
  const { syncAccount } = await import("../src/lib/sync");
  db.rows("accounts").push({ id: "w2", user_id: A.id, provider: "whatsapp_web", display_name: "+1", external_id: "+1", remote_id: "acc_w2", status: "connected", can_send: true, last_synced_at: new Date().toISOString(), created_at: "2026-01-01T00:00:00.000Z" });
  db.rows("threads").push({ id: "tw2", user_id: A.id, account_id: "w2", external_id: "c2", subject: "Old", unread: true, last_message_at: "2026-11-20T10:00:00.000Z" });
  const msg = (id: string, text: string, ts: string) => ({ object: "Message", id, text, sender_id: "u", sender: { display_name: "Zara" }, is_sender: false, timestamp: ts, is_event: false, is_hidden: false, is_deleted: false });
  let net = stubFetch((c) => {
    if (c.url.startsWith(`${U}/acc_w2/chats?`)) return { data: [{ object: "Chat", id: "c1", name: "Zara", unread_count: 1, is_archived: false }, { object: "Chat", id: "c2", name: "Old", unread_count: 0, is_archived: false }] };
    if (c.url.startsWith(`${U}/acc_w2/chats/c1/messages`)) return { data: [msg("n1", "test 1", new Date().toISOString())] };
    if (c.url.startsWith(`${U}/acc_w2/chats/c2/messages`)) return { data: [msg("o1", "old", "2026-11-20T10:00:00.000Z")] };
    return undefined;
  });
  try { await syncAccount("w2"); } finally { net.restore(); }
  assert.ok(db.rows("messages").some((m) => m.external_id === "c1:n1" && m.body_text === "test 1"), "new message arrives though the chat list has no times");
  assert.equal(db.rows("threads").find((t) => t.id === "tw2")!.unread, false, "read on the phone -> read here");

  net = stubFetch((c) => {
    if (c.url === `${U}/acc_w2/chats/c1`) return { object: "Chat", id: "c1", name: "Zara", unread_count: 2, is_archived: false };
    if (c.url.startsWith(`${U}/acc_w2/chats/c1/messages`)) return { data: [msg("n1", "test 1", new Date().toISOString()), msg("n2", "test 2", new Date().toISOString())] };
    return undefined;
  });
  try { await syncAccount("w2", { chatId: "c1" }); } finally { net.restore(); }
  assert.ok(db.rows("messages").some((m) => m.external_id === "c1:n2"));
  assert.ok(net.calls.every((c) => !c.url.includes("/chats?")), "only that chat was fetched");
});

test("unipile v2: fast check (app open) fetches only chats with a newer message and mirrors phone reads", async () => {
  const { quickUnipileCheck } = await import("../src/lib/unipile");
  db.rows("accounts").push({ id: "w3", user_id: A.id, provider: "whatsapp_web", display_name: "+3", external_id: "+3", remote_id: "acc_w3", status: "connected", can_send: true });
  db.rows("threads").push(
    { id: "q31", user_id: A.id, account_id: "w3", external_id: "k1", subject: "Kim", unread: false, last_message_at: "2026-11-23T17:00:00.000Z" },
    { id: "q32", user_id: A.id, account_id: "w3", external_id: "k2", subject: "Lee", unread: true, last_message_at: "2026-11-23T16:00:00.000Z" },
  );
  const net = stubFetch((c) => {
    if (c.url.startsWith(`${U}/acc_w3/chats?`)) return { data: [
      { object: "Chat", id: "k1", name: "Kim", unread_count: 1, last_message_timestamp: "2026-11-23T17:05:00.000Z", is_archived: false },
      { object: "Chat", id: "k2", name: "Lee", unread_count: 0, last_message_timestamp: "2026-11-23T16:00:00.000Z", is_archived: false },
    ] };
    if (c.url.startsWith(`${U}/acc_w3/chats/k1/messages`)) return { data: [{ object: "Message", id: "z1", text: "ping", sender_id: "u", sender: { display_name: "Kim" }, is_sender: false, timestamp: "2026-11-23T17:05:00.000Z", is_event: false, is_hidden: false, is_deleted: false }] };
    return undefined;
  });
  try {
    assert.equal(await quickUnipileCheck("w3"), 2);
    assert.ok(net.calls.every((c) => !c.url.includes("/chats/k2/messages")), "unchanged chat not downloaded");
    assert.ok(db.rows("messages").some((m) => m.external_id === "k1:z1"));
    assert.equal(db.rows("threads").find((t) => t.id === "q31")!.unread, true);
    assert.equal(db.rows("threads").find((t) => t.id === "q32")!.unread, false, "read on the phone");
    const n = net.calls.length;
    assert.equal(await quickUnipileCheck("w3"), 0, "throttled");
    assert.equal(net.calls.length, n);
  } finally { net.restore(); }
});

test("media: only the message owner can load its attachment, and non-media downloads instead of rendering", async () => {
  const media = await import("../src/app/api/media/route");
  db.rows("accounts").push({ id: "w4", user_id: A.id, provider: "whatsapp_web", display_name: "+4", external_id: "+4", remote_id: "acc_w4", status: "connected" });
  db.rows("messages").push({ id: "11111111-1111-4111-8111-111111111111", user_id: A.id, account_id: "w4", thread_id: "x", external_id: "chatA:msgA", attachments: [{ id: "att1", type: "img", mime: "image/jpeg" }, { id: "att2", type: "file", name: "a.html" }] });
  const prev = db.user;
  const net = stubFetch((c) => c.url.endsWith("/attachments/att1") ? new Response("jpegbytes", { headers: { "content-type": "image/jpeg" } })
    : c.url.endsWith("/attachments/att2") ? new Response("<script>x</script>", { headers: { "content-type": "text/html" } }) : undefined);
  try {
    db.user = { id: B.id, email: B.email };
    assert.equal((await media.GET(new NextRequest("https://app.test/api/media?m=11111111-1111-4111-8111-111111111111&a=att1"))).status, 404, "someone else");
    db.user = { id: A.id, email: A.email };
    const ok = await media.GET(new NextRequest("https://app.test/api/media?m=11111111-1111-4111-8111-111111111111&a=att1"));
    assert.equal(ok.status, 200); assert.equal(ok.headers.get("content-type"), "image/jpeg"); assert.equal(await ok.text(), "jpegbytes");
    assert.ok(net.calls[0].url.endsWith("/v2/acc_w4/chats/chatA/messages/msgA/attachments/att1"));
    const html = await media.GET(new NextRequest("https://app.test/api/media?m=11111111-1111-4111-8111-111111111111&a=att2"));
    assert.equal(html.headers.get("content-type"), "application/octet-stream");
    assert.match(String(html.headers.get("content-disposition")), /^attachment/);
    assert.equal((await media.GET(new NextRequest("https://app.test/api/media?m=11111111-1111-4111-8111-111111111111&a=nope"))).status, 404, "unknown attachment id");
  } finally { net.restore(); db.user = prev; }
});

test("unipile v2: a new-message webhook is stored straight away, even if Unipile's message list hasn't caught up", async () => {
  const { webhookKey, payloadMessage } = await import("../src/lib/unipile");
  const hook = await import("../src/app/api/webhooks/unipile/route");
  db.rows("accounts").push({ id: "w5", user_id: A.id, provider: "whatsapp_web", display_name: "+5", external_id: "+5", remote_id: "acc_w5", status: "connected", can_send: true });
  const body = { event: "message.new", account_id: "acc_w5", data: { message: { object: "Message", id: "mB", chat_id: "chat5@lid", text: "test B", sender_id: "u9", sender: { display_name: "Abdul Hadi" }, is_sender: false, timestamp: "2026-11-23T18:59:26.000Z", attachments: [] } } };
  assert.equal(payloadMessage(body)?.chat_id, "chat5@lid");
  const net = stubFetch((c) => {
    if (c.url === `${U}/acc_w5/chats/chat5%40lid`) return { object: "Chat", id: "chat5@lid", name: "Abdul Hadi", unread_count: 1, is_archived: false };
    if (c.url.startsWith(`${U}/acc_w5/chats/chat5%40lid/messages`)) return { data: [] }; // lagging list
    return undefined;
  });
  try {
    const r = await hook.POST(new NextRequest(`https://app.test/api/webhooks/unipile?k=${webhookKey()}`, { method: "POST", body: JSON.stringify(body) }));
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 50));
  } finally { net.restore(); }
  const m = db.rows("messages").find((x) => x.external_id === "chat5@lid:mB");
  assert.ok(m, "stored from the webhook");
  assert.equal(m!.body_text, "test B");
  const t = db.rows("threads").find((x) => x.account_id === "w5")!;
  assert.equal(t.subject, "Abdul Hadi"); assert.equal(t.unread, true);
});

test("unipile v2: a 'retry in …' limit pauses message downloads; chat.update webhooks mirror read state with no request", async () => {
  const { syncAccount } = await import("../src/lib/sync");
  const { webhookKey } = await import("../src/lib/unipile");
  const hook = await import("../src/app/api/webhooks/unipile/route");
  db.rows("accounts").push({ id: "w6", user_id: A.id, provider: "whatsapp_web", display_name: "+6", external_id: "+6", remote_id: "acc_w6", status: "connected", can_send: true, last_synced_at: null, created_at: "2026-01-01T00:00:00.000Z" });
  let net = stubFetch((c) => {
    if (c.url.startsWith(`${U}/acc_w6/chats?`)) return { data: [{ object: "Chat", id: "x1", name: "X", unread_count: 1, is_archived: false }, { object: "Chat", id: "x2", name: "Y", unread_count: 0, is_archived: false }] };
    if (c.url.includes("/acc_w6/chats/x1/messages")) return new Response(JSON.stringify({ detail: "We only allow 100 requests. Retry in 21 hours." }), { status: 429, headers: { "content-type": "application/json" } });
    return undefined;
  });
  try { await syncAccount("w6"); } finally { net.restore(); }
  assert.ok(net.calls.every((c) => !c.url.includes("/chats/x2/messages")), "stops downloading after the limit");
  assert.equal(db.rows("accounts").find((a) => a.id === "w6")!.status, "connected", "a limit isn't a disconnect");
  net = stubFetch((c) => (c.url.startsWith(`${U}/acc_w6/chats?`) ? { data: [] } : undefined));
  try { await syncAccount("w6"); } finally { net.restore(); }
  assert.ok(net.calls.every((c) => !c.url.includes("/messages")), "still paused");

  db.rows("threads").push({ id: "tx2", user_id: A.id, account_id: "w6", external_id: "x2", subject: "Y", unread: true, last_message_at: new Date().toISOString() });
  net = stubFetch(() => undefined);
  try {
    await hook.POST(new NextRequest(`https://app.test/api/webhooks/unipile?k=${webhookKey()}`, { method: "POST", body: JSON.stringify({ type: "chat.update", account_id: "acc_w6", payload: { id: "x2", unread_count: 0 } }) }));
    await new Promise((r) => setTimeout(r, 30));
  } finally { net.restore(); }
  assert.equal(db.rows("threads").find((t) => t.id === "tx2")!.unread, false, "read on the phone, via webhook");
  assert.equal(net.calls.length, 0, "no Unipile request needed");
});

test("unipile v2: an incoming message turning seen (read on the phone) marks the chat read; your own messages don't", async () => {
  const { webhookKey } = await import("../src/lib/unipile");
  const hook = await import("../src/app/api/webhooks/unipile/route");
  db.rows("accounts").push({ id: "w7", user_id: A.id, provider: "whatsapp_web", display_name: "+7", external_id: "+7", remote_id: "acc_w7", status: "connected" });
  db.rows("threads").push({ id: "t7", user_id: A.id, account_id: "w7", external_id: "c7@lid", subject: "Z", unread: true, last_message_at: new Date().toISOString() });
  const send = (payload: object) => hook.POST(new NextRequest(`https://app.test/api/webhooks/unipile?k=${webhookKey()}`, { method: "POST", body: JSON.stringify({ type: "message.update", account_id: "acc_w7", payload }) }));
  await send({ id: "m1", chat_id: "c7@lid", is_sender: true, is_seen: true });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(db.rows("threads").find((t) => t.id === "t7")!.unread, true, "the other person reading YOUR message changes nothing");
  await send({ id: "m2", chat_id: "c7@lid", is_sender: false, is_seen: true });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(db.rows("threads").find((t) => t.id === "t7")!.unread, false);
});

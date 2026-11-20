import { A, B, db } from "./setup";
import { stubFetch } from "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.UNIPILE_DSN = "api9.unipile.test:13000";
process.env.UNIPILE_API_KEY = "uk";

const U = "https://api9.unipile.test:13000/api/v1";

test("unipile: hosted link carries a signed state; forged or unsigned states are refused", async () => {
  const { hostedConnectLink, connectState, readState } = await import("../src/lib/unipile");
  const net = stubFetch((c) => (c.url === `${U}/hosted/accounts/link` ? { object: "HostedAuthURL", url: "https://account.unipile.test/abc" } : undefined));
  try {
    assert.equal(await hostedConnectLink(A.id, "gmail"), "https://account.unipile.test/abc");
    const body = JSON.parse(net.calls[0].body);
    assert.deepEqual(body.providers, ["GOOGLE"]);
    assert.equal(body.type, "create");
    assert.equal(body.notify_url, "https://app.test/api/webhooks/unipile/connected");
    assert.deepEqual(readState(body.name), { userId: A.id, provider: "gmail" });
  } finally { net.restore(); }
  const forged = connectState(A.id, "gmail").replace(A.id, B.id);
  assert.equal(readState(forged), null);
  assert.equal(readState(`${A.id}.gmail`), null);
});

test("unipile: finishing the sign-in page adds the account for the right user, then email syncs into conversations", async () => {
  const { connectState } = await import("../src/lib/unipile");
  const notify = await import("../src/app/api/webhooks/unipile/connected/route");
  const { syncAccount } = await import("../src/lib/sync");
  const net = stubFetch((c) => {
    if (c.url === `${U}/accounts/ua1`) return { object: "Account", id: "ua1", type: "GOOGLE_OAUTH", name: "sam@gmail.com", connection_params: { mail: { username: "sam@gmail.com" } } };
    if (c.url === `${U}/webhooks`) return { object: "WebhookCreated", webhook_id: "w1" };
    if (c.url.startsWith(`${U}/emails?`)) return { object: "EmailList", items: [
      { id: "e1", thread_id: "th1", subject: "Invoice", body_plain: "Please pay", date: "2026-11-20T10:00:00.000Z", role: "inbox", read_date: null, message_id: "<m1@x>", from_attendee: { display_name: "Dana", identifier: "dana@client.com" }, to_attendees: [{ identifier: "sam@gmail.com" }] },
      { id: "e2", thread_id: "th1", subject: "Re: Invoice", body: "<p>Paid!</p>", date: "2026-11-20T11:00:00.000Z", role: "sent", from_attendee: { identifier: "sam@gmail.com" }, to_attendees: [{ identifier: "dana@client.com" }] },
    ] };
    return undefined;
  });
  try {
    const res = await notify.POST(new NextRequest("https://app.test/api/webhooks/unipile/connected", { method: "POST", body: JSON.stringify({ status: "CREATION_SUCCESS", account_id: "ua1", name: connectState(A.id, "gmail") }) }));
    assert.equal(res.status, 200);
    const acct = db.rows("accounts").find((a) => a.remote_id === "ua1")!;
    assert.equal(acct.user_id, A.id);
    assert.equal(acct.provider, "gmail");
    assert.equal(acct.external_id, "sam@gmail.com");
    assert.ok(net.calls.filter((c) => c.url === `${U}/webhooks`).length === 2, "message + email webhooks registered");
    const r = await syncAccount(acct.id as string);
    assert.equal(r.synced, 2);
    const t = db.rows("threads").find((x) => x.account_id === acct.id && x.external_id === "th1")!;
    assert.equal(t.unread, false, "you replied last");
    const msgs = db.rows("messages").filter((m) => m.thread_id === t.id);
    assert.equal(msgs.length, 2);
    assert.equal(msgs.find((m) => m.external_id === "e2")!.body_text, "Paid!");
    // A forged notify (wrong signature) adds nothing.
    const bad = await notify.POST(new NextRequest("https://app.test/api/webhooks/unipile/connected", { method: "POST", body: JSON.stringify({ status: "CREATION_SUCCESS", account_id: "ua1", name: `${B.id}.gmail.${"0".repeat(32)}` }) }));
    assert.equal(bad.status, 400);
  } finally { net.restore(); }
});

test("unipile: WhatsApp chats sync with names and unread, replies and read state go back to WhatsApp", async () => {
  const { syncAccount } = await import("../src/lib/sync");
  const { applyThreadAction } = await import("../src/lib/thread-actions");
  db.rows("accounts").push({ id: "w1", user_id: A.id, provider: "whatsapp_web", display_name: "+923001112222", external_id: "+923001112222", remote_id: "uw1", status: "connected", can_send: true });
  let net = stubFetch((c) => {
    if (c.url.startsWith(`${U}/chats?`)) return { object: "ChatList", items: [{ id: "c1", name: null, timestamp: "2026-11-20T12:00:00.000Z", unread_count: 1, attendee_provider_id: "923339998888@s.whatsapp.net" }] };
    if (c.url.startsWith(`${U}/chats/c1/messages`)) return { object: "MessageList", items: [
      { id: "m1", text: "Hi, are you free?", sender_id: "923339998888@s.whatsapp.net", is_sender: 0, timestamp: "2026-11-20T11:59:00.000Z" },
      { id: "m0", text: "Hello", sender_id: "me", is_sender: 1, timestamp: "2026-11-20T11:58:00.000Z" },
    ] };
    if (c.url === `${U}/chats/c1/attendees`) return { object: "ChatAttendeeList", items: [{ id: "a1", provider_id: "923339998888@s.whatsapp.net", name: "Ali Khan", is_self: 0 }] };
    return undefined;
  });
  try { await syncAccount("w1"); } finally { net.restore(); }
  const t = db.rows("threads").find((x) => x.account_id === "w1")!;
  assert.equal(t.subject, "Ali Khan");
  assert.equal(t.unread, true);
  assert.equal(db.rows("messages").filter((m) => m.thread_id === t.id).length, 2);

  net = stubFetch((c) => (c.url === `${U}/chats/c1` && c.method === "PATCH" ? { object: "ChatPatched" } : undefined));
  try {
    const r = await applyThreadAction(A.id, [t.id as string], "read");
    assert.equal(r.mirrored, 1);
    assert.deepEqual(JSON.parse(net.calls[0].body), { action: "setReadStatus", value: true });
  } finally { net.restore(); }
});

test("unipile: incoming webhook needs our key and refreshes only that account", async () => {
  const { webhookKey } = await import("../src/lib/unipile");
  const hook = await import("../src/app/api/webhooks/unipile/route");
  const no = await hook.POST(new NextRequest("https://app.test/api/webhooks/unipile", { method: "POST", body: JSON.stringify({ account_id: "uw1" }) }));
  assert.equal(no.status, 401);
  const yes = await hook.POST(new NextRequest("https://app.test/api/webhooks/unipile", { method: "POST", headers: { "x-ub-key": webhookKey() }, body: JSON.stringify({ account_id: "nobody" }) }));
  assert.equal(yes.status, 200);
});

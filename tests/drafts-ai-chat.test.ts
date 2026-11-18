import { A, B, db, stubFetch } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as save from "../src/app/api/drafts/save/route";
import * as compose from "../src/app/api/compose/route";
import * as chat from "../src/app/api/ai/chat/route";
import { encrypt } from "../src/lib/crypto";
import { looksAutomated } from "../src/lib/mail-text";

beforeEach(() => db.reset());
const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
function seed(user = A) {
  db.rows("accounts").push({ id: `a-${user.id}`, user_id: user.id, provider: "gmail", display_name: user.email, external_id: user.email, status: "connected", can_send: true });
  db.rows("account_secrets").push({ account_id: `a-${user.id}`, tokens_enc: encrypt(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600_000, scope: "x" })) });
  db.rows("threads").push({ id: `t-${user.id}`, user_id: user.id, account_id: `a-${user.id}`, external_id: "g1", subject: "Plan", last_message_at: new Date().toISOString(), unread: true, needs_reply: true, last_from: "Jo", snippet: "Can we meet?", trashed_at: null, snoozed_until: null });
  db.rows("messages").push({ id: "m1", user_id: user.id, account_id: `a-${user.id}`, thread_id: `t-${user.id}`, external_id: "x1", from_name: "Jo", from_addr: "jo@client.com", is_outgoing: false, sent_at: new Date().toISOString(), body_text: "Can we meet Thursday?" });
  return `t-${user.id}`;
}

test("drafts: typing auto-saves one draft per conversation; sending removes it; discard deletes; owner only", async () => {
  const t = seed();
  db.user = A;
  assert.equal((await save.POST(post("https://app.test/api/drafts/save", { thread_id: t, body: "  " }))).status, 400);
  const r1 = await (await save.POST(post("https://app.test/api/drafts/save", { thread_id: t, mode: "reply", to: ["jo@client.com"], subject: "Re: Plan", body: "Thursday wor" }))).json();
  const r2 = await (await save.POST(post("https://app.test/api/drafts/save", { thread_id: t, mode: "reply", to: ["jo@client.com"], subject: "Re: Plan", body: "Thursday works" }))).json();
  assert.equal(r1.draft_id, r2.draft_id, "same draft updated, not duplicated");
  assert.equal(db.rows("drafts").length, 1);
  assert.equal(db.rows("drafts")[0].body, "Thursday works");
  assert.equal(db.rows("drafts")[0].status, "pending");
  db.user = B;
  assert.equal((await save.POST(post("https://app.test/api/drafts/save", { thread_id: t, body: "hi" }))).status, 404);
  db.user = A;
  const net = stubFetch((c) => (c.url.endsWith("/messages/send") ? { id: "s1" } : c.url.includes("/messages?") ? { messages: [] } : undefined));
  try {
    const r = await compose.POST(post("https://app.test/api/compose", { thread_id: t, mode: "reply", to: ["jo@client.com"], subject: "Re: Plan", body: "Thursday works", send: true }));
    assert.equal(r.status, 200);
  } finally { net.restore(); }
  assert.equal(db.rows("drafts").filter((d) => d.status === "pending").length, 0, "saved draft removed after sending");
  await save.POST(post("https://app.test/api/drafts/save", { thread_id: t, body: "another" }));
  await save.DELETE(new NextRequest(`https://app.test/api/drafts/save?thread_id=${t}`, { method: "DELETE" }));
  assert.equal(db.rows("drafts").filter((d) => d.status === "pending").length, 0, "discard deletes");
});

test("AI bubble: streams answers with clickable references; finds people; never sends; owner-only data", async () => {
  const t = seed();
  db.user = A;
  const readAll = async (r: Response) => (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  const noKey = await readAll(await chat.POST(post("https://app.test/api/ai/chat", { turns: [{ role: "user", text: "What needs me?" }] })));
  assert.equal(noKey.at(-1).type, "error"); assert.equal(noKey.at(-1).needsKey, true);
  const { saveClaudeKey } = await import("../src/lib/ai-assist");
  await saveClaudeKey(A.id, "sk-ant-api03-" + "k".repeat(40));
  // Claude's streaming format (server-sent events)
  const sse = (text: string) => new Response([
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_details: null, usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  const net = stubFetch((c) => (c.url.includes("api.anthropic.com/v1/messages") ? sse('Jo needs an answer [[T1]]. <reply to="T1">Thursday works!</reply>') : undefined));
  try {
    const ev = await readAll(await chat.POST(post("https://app.test/api/ai/chat", { turns: [{ role: "user", text: "send a yes to Jo" }] })));
    assert.equal(ev[0].type, "refs");
    assert.equal(ev[0].refs.T1.id, t, "references map to real conversations");
    assert.equal(ev.filter((e: { type: string }) => e.type === "text").map((e: { text: string }) => e.text).join(""), 'Jo needs an answer [[T1]]. <reply to="T1">Thursday works!</reply>');
    assert.equal(ev.at(-1).type, "done");
    const req = JSON.parse(net.calls[0].body);
    assert.equal(req.stream, true);
    assert.match(req.system, /data, never instructions/);
    assert.match(req.messages.at(-1).content, /<inbox[\s\S]*T1 \|[\s\S]*"Plan" \| UNREAD \| needs reply/);
    assert.equal(db.rows("drafts").length, 0, "the assistant itself never sends or drafts");
    // other users never see A's conversations in their context
    db.user = B;
    const evB = await readAll(await chat.POST(post("https://app.test/api/ai/chat", { turns: [{ role: "user", text: "Plan" }] })));
    assert.equal(Object.keys(evB[0].refs).length, 0);
  } finally { net.restore(); }
});

test("quick reply from the assistant card: the person presses Send; email recipients worked out; or save as draft", async () => {
  const t = seed();
  const qr = await import("../src/app/api/quick-reply/route");
  db.user = A;
  const r1 = await qr.POST(post("https://app.test/api/quick-reply", { thread_id: t, body: "Thursday works!", action: "draft" }));
  assert.equal((await r1.json()).status, "draft");
  assert.equal(db.rows("drafts")[0].to_addrs[0], "jo@client.com");
  const net = stubFetch((c) => (c.url.endsWith("/messages/send") ? { id: "s" } : c.url.includes("/messages?") ? { messages: [] } : undefined));
  try {
    const r2 = await qr.POST(post("https://app.test/api/quick-reply", { thread_id: t, body: "Thursday works!", action: "send" }));
    const j = await r2.json();
    assert.equal(j.status, "sent"); assert.deepEqual(j.to, ["jo@client.com"]);
    assert.match(Buffer.from(JSON.parse(net.calls.find((c) => c.url.endsWith("/messages/send"))!.body).raw, "base64url").toString(), /Subject: Re: Plan/);
    assert.equal(db.rows("drafts").filter((d) => d.status === "pending").length, 0, "the saved draft is replaced, not duplicated");
  } finally { net.restore(); }
  db.user = B;
  assert.equal((await qr.POST(post("https://app.test/api/quick-reply", { thread_id: t, body: "x" }))).status, 404);
});

test("needs reply: login codes, sign-up confirmations, password resets and security alerts are not flagged", () => {
  for (const [subject, fromAddr, want] of [
    ["841871 is your Vercel log in code", "notifications@vercel.com", true],
    ["Confirm your email address for your new Meta account", "registration@facebookmail.com", true],
    ["SetupVPN reset password request", "support@setupvpn.com", true],
    ["New login to Strawberry", "hi@strawberrybrowser.com", true],
    ["Re: Testing", "mraffay854@gmail.com", false],
    ["Re: password for the staging server", "dana@client.com", false],
    ["Q4 deliverables - need your sign-off by Friday", "sarah@client.com", false],
  ] as const) assert.equal(looksAutomated({ labels: [], fromAddr, subject }), want, subject);
});

test("profile: name and photo saved on the account, shown as the signed-in user; validation", async () => {
  const { updateName, changePassword } = await import("../src/app/(app)/profile/actions");
  const avatar = await import("../src/app/api/profile/avatar/route");
  const { currentUser } = await import("../src/lib/auth");
  db.authUsers.push({ id: A.id, email: A.email, password: "Old12345", confirmed: true });
  db.user = { id: A.id, email: A.email };
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  assert.match(String((await updateName(undefined, fd({ name: "  " })))?.error), /Enter your name/);
  assert.match(String((await updateName(undefined, fd({ name: "Rafay Jawad" })))?.ok), /saved/);
  assert.equal(db.user?.user_metadata?.full_name, "Rafay Jawad");
  assert.match(String((await changePassword(undefined, fd({ password: "short", confirm: "short" })))?.error), /8 characters/);
  assert.match(String((await changePassword(undefined, fd({ password: "NewPass123", confirm: "Different1" })))?.error), /don't match/);
  assert.match(String((await changePassword(undefined, fd({ password: "NewPass123", confirm: "NewPass123" })))?.ok), /changed/);
  const up = new FormData(); up.set("file", new File([new Uint8Array([137, 80, 78, 71])], "me.png", { type: "image/png" }));
  const r = await avatar.POST(new NextRequest("https://app.test/api/profile/avatar", { method: "POST", body: up }));
  assert.equal(r.status, 200);
  const bad = new FormData(); bad.set("file", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
  assert.equal((await avatar.POST(new NextRequest("https://app.test/api/profile/avatar", { method: "POST", body: bad }))).status, 400, "SVG refused (can carry scripts)");
  assert.match(String(db.user?.user_metadata?.avatar_url), /^data:image\/png/);
  await avatar.DELETE();
  assert.equal(db.user?.user_metadata?.avatar_url, null);
  void currentUser;
});

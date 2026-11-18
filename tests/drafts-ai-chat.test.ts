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

test("AI bubble: answers about the inbox or one conversation with the user's key; never sends; needs a key", async () => {
  const t = seed();
  db.user = A;
  assert.equal((await chat.POST(post("https://app.test/api/ai/chat", { question: "What needs me?" }))).status, 412);
  const { saveClaudeKey } = await import("../src/lib/ai-assist");
  await saveClaudeKey(A.id, "sk-ant-api03-" + "k".repeat(40));
  const reply = { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "Reply to Jo about Thursday. <reply>Thursday works!</reply>" }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1, output_tokens: 1 } };
  const net = stubFetch((c) => (c.url.includes("api.anthropic.com/v1/messages") ? new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } }) : undefined));
  try {
    const r1 = await (await chat.POST(post("https://app.test/api/ai/chat", { question: "What needs my reply today?" }))).json();
    assert.match(r1.text, /Thursday/);
    assert.match(JSON.parse(net.calls[0].body).messages[0].content, /<inbox[\s\S]*"Plan" \| UNREAD \| needs reply/);
    const r2 = await (await chat.POST(post("https://app.test/api/ai/chat", { question: "Draft a reply", thread_id: t }))).json();
    assert.match(r2.text, /<reply>Thursday works!<\/reply>/);
    assert.match(JSON.parse(net.calls[1].body).messages[0].content, /<conversation kind="email"[\s\S]*Can we meet Thursday/);
    assert.equal(net.calls.length, 2, "only AI calls, nothing sent");
    db.user = B;
    assert.equal((await chat.POST(post("https://app.test/api/ai/chat", { question: "x", thread_id: t }))).status, 404);
  } finally { net.restore(); }
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

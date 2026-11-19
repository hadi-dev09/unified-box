import { A, db, stubFetch } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as compose from "../src/app/api/compose/route";
import * as assist from "../src/app/api/ai/assist/route";
import { encrypt } from "../src/lib/crypto";
import { fillName } from "../src/lib/ai-assist";
import { ingestSlackEvent } from "../src/lib/slack";
import { findPlaceholder } from "../src/app/placeholder";

beforeEach(() => db.reset());
const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("placeholders: found before sending; markdown links aren't placeholders; AI name filled in", () => {
  assert.equal(findPlaceholder("Thanks,\n[Your name]"), "[Your name]");
  assert.equal(findPlaceholder("See [the doc](https://x.io)"), null);
  assert.equal(findPlaceholder("All good, see you Friday"), null);
  assert.equal(fillName("Thanks,\n[Your name]", "Rafay Jawad"), "Thanks,\nRafay Jawad");
  assert.equal(fillName("Thanks,\n[Your name]", ""), "Thanks,\n[Your name]");
});

test("Write with AI: the user's profile name is given to the AI and replaces any leftover placeholder", async () => {
  db.user = { id: A.id, email: A.email, user_metadata: { full_name: "Rafay Jawad" } };
  db.rows("accounts").push({ id: "g1", user_id: A.id, provider: "gmail", display_name: A.email, external_id: A.email, status: "connected", can_send: true });
  db.rows("threads").push({ id: "t1", user_id: A.id, account_id: "g1", external_id: "x", subject: "Webinar" });
  db.rows("messages").push({ id: "m1", user_id: A.id, account_id: "g1", thread_id: "t1", external_id: "e1", from_name: "Events", from_addr: "events@x.com", is_outgoing: false, sent_at: new Date().toISOString(), body_text: "Want to join Dec 3?" });
  const { saveClaudeKey } = await import("../src/lib/ai-assist");
  await saveClaudeKey(A.id, "sk-ant-api03-" + "k".repeat(40));
  const reply = { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "Hi,\nPlease register me.\nThanks,\n[Your name]" }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1, output_tokens: 1 } };
  const net = stubFetch(() => new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } }));
  try {
    const j = await (await assist.POST(post("https://app.test/api/ai/assist", { thread_id: "t1", task: "draft" }))).json();
    assert.match(j.text, /Thanks,\nRafay Jawad$/);
    assert.match(JSON.parse(net.calls[0].body).messages[0].content, /<me name="Rafay Jawad"/);
  } finally { net.restore(); }
});

test("slack threads: a thread reply is stored with its parent; replying in a thread posts into that thread", async () => {
  db.user = A;
  db.rows("accounts").push({ id: "s1", user_id: A.id, provider: "slack", display_name: "WS", external_id: "T1:U1", status: "connected", can_send: true });
  db.rows("account_secrets").push({ account_id: "s1", tokens_enc: encrypt(JSON.stringify({ access_token: "xoxp" })) });
  db.rows("threads").push({ id: "th", user_id: A.id, account_id: "s1", external_id: "D1", subject: "DM · Hadi" });
  let net = stubFetch((c) => (c.url.includes("users.info") ? { ok: true, user: { real_name: "Hadi", profile: {} } } : undefined));
  try {
    await ingestSlackEvent({ id: "s1", user_id: A.id, external_id: "T1:U1" }, { type: "message", channel: "D1", channel_type: "im", user: "U2", text: "hi", ts: "1795115614.271319", thread_ts: "1795115100.000100" });
  } finally { net.restore(); }
  assert.equal(db.rows("messages")[0].thread_ts, "1795115100.000100");
  net = stubFetch((c) => (c.url.endsWith("/chat.postMessage") ? { ok: true, ts: "1795116000.000100" } : undefined));
  try {
    const r = await compose.POST(post("https://app.test/api/compose", { thread_id: "th", body: "on it", send: true, reply_to: "1795115100.000100" }));
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    assert.equal(JSON.parse(net.calls[0].body).thread_ts, "1795115100.000100");
    assert.equal(db.rows("messages").find((m) => m.external_id === "D1:1795116000.000100")!.thread_ts, "1795115100.000100");
  } finally { net.restore(); }
});

import { A, B, db, stubFetch } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import * as compose from "../src/app/api/compose/route";
import * as draftsRoute from "../src/app/api/drafts/[id]/route";
import { encrypt } from "../src/lib/crypto";
import { sendDueScheduled } from "../src/lib/send";
import { backgroundSync } from "../src/lib/cron";

beforeEach(() => db.reset());
const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const draftAct = (id: string, action: string) => draftsRoute.POST(post(`https://app.test/api/drafts/${id}`, { action }), { params: Promise.resolve({ id }) });
const sends = (n: { calls: { url: string }[] }) => n.calls.filter((c) => c.url.endsWith("/messages/send") || c.url.endsWith("/chat.postMessage")).length;

function seed(provider = "gmail", canSend = true, user = A) {
  const acct = `acct-${provider}-${user.id.slice(0, 4)}`;
  db.rows("accounts").push({ id: acct, user_id: user.id, provider, display_name: user.email, external_id: provider === "slack" ? "T1:U1" : user.email, status: "connected", can_send: canSend, last_synced_at: new Date().toISOString() });
  db.rows("account_secrets").push({ account_id: acct, tokens_enc: encrypt(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600_000, scope: "x" })) });
  const t = `t-${provider}-${user.id.slice(0, 4)}`;
  db.rows("threads").push({ id: t, user_id: user.id, account_id: acct, external_id: provider === "slack" ? "C1" : "gthread", subject: "Plan" });
  return t;
}
const later = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

test("schedule: saved (not sent) with a valid future time; bad times and read-only accounts refused", async () => {
  const t = seed();
  db.user = A;
  const net = stubFetch(() => ({}));
  try {
    const base = { thread_id: t, mode: "reply", to: ["jo@client.com"], subject: "Re: Plan", body: "See you Monday", send: true };
    assert.equal((await compose.POST(post("https://app.test/api/compose", { ...base, send_at: new Date(Date.now() - 60_000).toISOString() }))).status, 400);
    assert.equal((await compose.POST(post("https://app.test/api/compose", { ...base, send_at: "not a date" }))).status, 400);
    const r = await compose.POST(post("https://app.test/api/compose", { ...base, send_at: later(60) }));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).status, "scheduled");
    assert.equal(sends(net), 0, "nothing sent yet");
    const d = db.rows("drafts")[0];
    assert.equal(d.status, "scheduled"); assert.equal(d.created_by, "user");
  } finally { net.restore(); }
  db.reset();
  const ro = seed("gmail", false);
  db.user = A;
  const r2 = await compose.POST(post("https://app.test/api/compose", { thread_id: ro, mode: "reply", to: ["a@b.co"], subject: "s", body: "b", send: true, send_at: later(60) }));
  assert.equal(r2.status, 400);
});

test("schedule: background job sends due messages exactly once; future ones wait", async () => {
  const t = seed();
  db.rows("drafts").push(
    { id: "due1", user_id: A.id, account_id: db.rows("accounts")[0].id, thread_id: t, mode: "reply", to_addrs: ["jo@client.com"], cc_addrs: [], subject: "Re: Plan", body: "hi", status: "scheduled", created_by: "user", send_at: new Date(Date.now() - 1000).toISOString() },
    { id: "future", user_id: A.id, account_id: db.rows("accounts")[0].id, thread_id: t, mode: "reply", to_addrs: ["jo@client.com"], cc_addrs: [], subject: "Re: Plan", body: "later", status: "scheduled", created_by: "user", send_at: later(120) },
  );
  const net = stubFetch((c) => (c.url.endsWith("/messages/send") ? { id: "sent" } : c.url.includes("/messages?") ? { messages: [] } : undefined));
  try {
    await backgroundSync();
    await sendDueScheduled();
    assert.equal(sends(net), 1, "sent once even though the job ran twice");
    assert.equal(db.rows("drafts").find((d) => d.id === "due1")!.status, "sent");
    assert.equal(db.rows("drafts").find((d) => d.id === "future")!.status, "scheduled");
  } finally { net.restore(); }
});

test("schedule: cancel and send now are owner-only and only while still scheduled (Slack too)", async () => {
  const t = seed("slack");
  db.user = A;
  const net = stubFetch((c) => (c.url.endsWith("/chat.postMessage") ? { ok: true, ts: "1700000000.0001" } : undefined));
  try {
    for (const id of ["s1", "s2"]) {
      const r = await compose.POST(post("https://app.test/api/compose", { thread_id: t, body: `msg ${id}`, send: true, send_at: later(30) }));
      assert.equal(r.status, 200);
    }
    const [s1, s2] = db.rows("drafts").map((d) => d.id as string);
    db.user = B;
    assert.equal((await draftAct(s1, "send_now")).status, 404, "other users can't touch it");
    db.user = A;
    assert.equal((await draftAct(s1, "cancel")).status, 200);
    assert.equal((await draftAct(s1, "send_now")).status, 404, "cancelled stays cancelled");
    assert.equal((await draftAct(s2, "send_now")).status, 200);
    assert.equal(sends(net), 1);
    assert.equal(db.rows("drafts").find((d) => d.id === s2)!.status, "sent");
    assert.equal((await draftAct(s2, "cancel")).status, 404, "already sent");
  } finally { net.restore(); }
});

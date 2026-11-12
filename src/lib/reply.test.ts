import { test } from "node:test";
import assert from "node:assert/strict";
import { forwardBlock, isGroup, parseAddressField, replyRecipients, replySubject, type Msg } from "./reply.ts";

const me = "me@x.com";
const m = (o: Partial<Msg>): Msg => ({ from_addr: "a@x.com", to_addrs: [me], cc_addrs: [], is_outgoing: false, sent_at: "2026-01-01T00:00:00Z", ...o });

test("reply goes to the last sender; reply-all adds everyone else, never me, no duplicates", () => {
  const msgs = [m({ from_addr: "Boss@acme.com", to_addrs: [me, "ann@acme.com"], cc_addrs: ["bob@acme.com", "ME@x.com", "ann@acme.com"], sent_at: "2026-01-02T00:00:00Z" }), m({ sent_at: "2026-01-01T00:00:00Z" })];
  assert.deepEqual(replyRecipients("reply", msgs, me), { to: ["Boss@acme.com"], cc: [] });
  assert.deepEqual(replyRecipients("reply_all", msgs, me), { to: ["Boss@acme.com"], cc: ["ann@acme.com", "bob@acme.com"] });
  assert.deepEqual(replyRecipients("forward", msgs, me), { to: [], cc: [] });
});

test("if I sent the last message, a reply goes to my recipients again", () => {
  const msgs = [m({ from_addr: me, is_outgoing: true, to_addrs: ["client@c.com"], cc_addrs: ["pm@c.com"] })];
  assert.deepEqual(replyRecipients("reply", msgs, me), { to: ["client@c.com"], cc: [] });
  assert.deepEqual(replyRecipients("reply_all", msgs, me), { to: ["client@c.com"], cc: ["pm@c.com"] });
});

test("isGroup / subjects / forward block / address parsing", () => {
  assert.equal(isGroup([m({})], me), false);
  assert.equal(isGroup([m({ cc_addrs: ["b@x.com"] })], me), true);
  assert.equal(replySubject("reply", "Hello"), "Re: Hello");
  assert.equal(replySubject("reply", "RE: Hello"), "RE: Hello");
  assert.equal(replySubject("forward", "Hello"), "Fwd: Hello");
  assert.equal(replySubject("forward", "Fw: Hello"), "Fw: Hello");
  const f = forwardBlock(m({ from_name: "Ann", subject: "Plan", body_text: "the body" }));
  assert.match(f, /Forwarded message/);
  assert.match(f, /From: Ann <a@x.com>/);
  assert.match(f, /the body$/);
  assert.deepEqual(parseAddressField("a@b.com, c@d.io; nope <e@f.co>"), { valid: ["a@b.com", "c@d.io", "e@f.co"], invalid: ["nope"] });
});

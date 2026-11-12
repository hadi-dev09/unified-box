import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, htmlToText, looksAutomated, parseFrom } from "./mail-text.ts";
import { safeNext } from "./safe-next.ts";

test("decodeEntities handles named, decimal and hex entities", () => {
  assert.equal(decodeEntities("you&#39;ve &amp; collector&#x27;s &hellip;"), "you've & collector's …");
  assert.equal(decodeEntities("&unknown; &#99999999999;"), "&unknown; &#99999999999;");
});

test("htmlToText strips tags/styles/scripts and keeps structure", () => {
  const html = `<html><head><style>p{color:red}</style><title>x</title></head><body><script>alert(1)</script>
    <p>Hello&nbsp;<b>world</b></p><ul><li>One</li><li>Two</li></ul><a href="https://t.co/x">Click</a><br>Bye</body></html>`;
  const t = htmlToText(html);
  assert.ok(!/alert|color:red|<|>/.test(t), t);
  assert.match(t, /Hello world/);
  assert.match(t, /• One\n• Two/);
  assert.match(t, /Click\nBye|Click\s*Bye/);
});

test("htmlToText collapses blank runs", () => {
  assert.equal(htmlToText("<p>a</p><p></p><p></p><p></p><p>b</p>"), "a\n\nb");
});

test("parseFrom", () => {
  assert.deepEqual(parseFrom('"Ada L" <ada@x.com>'), { name: "Ada L", addr: "ada@x.com" });
  assert.deepEqual(parseFrom("bob@x.com"), { name: "", addr: "bob@x.com" });
});

test("looksAutomated", () => {
  const base = { labels: [] as string[], fromAddr: "client@acme.com" };
  assert.equal(looksAutomated(base), false);
  assert.equal(looksAutomated({ ...base, listUnsubscribe: "<mailto:x>" }), true);
  assert.equal(looksAutomated({ ...base, labels: ["CATEGORY_PROMOTIONS"] }), true);
  assert.equal(looksAutomated({ ...base, precedence: "bulk" }), true);
  assert.equal(looksAutomated({ ...base, autoSubmitted: "auto-generated" }), true);
  assert.equal(looksAutomated({ ...base, autoSubmitted: "no" }), false);
  assert.equal(looksAutomated({ labels: [], fromAddr: "noreply@mail.app.supabase.io" }), true);
  assert.equal(looksAutomated({ labels: [], fromAddr: "no-reply@accounts.google.com" }), true);
  assert.equal(looksAutomated({ labels: [], fromAddr: "notifications@github.com" }), true);
  assert.equal(looksAutomated({ labels: [], fromAddr: "renoir@acme.com" }), false);
  assert.equal(looksAutomated({ labels: [], fromAddr: "jane.doe@acme.com" }), false);
});

test("safeNext blocks open redirects", () => {
  assert.equal(safeNext("/oauth/authorize?x=1"), "/oauth/authorize?x=1");
  assert.equal(safeNext("//evil.com"), "/");
  assert.equal(safeNext("https://evil.com"), "/");
  assert.equal(safeNext("/\\evil.com"), "/");
  assert.equal(safeNext(null), "/");
});

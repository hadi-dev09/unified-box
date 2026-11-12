import { test } from "node:test";
import assert from "node:assert/strict";
import { linkify, shortUrl } from "./linkify.ts";

test("markdown links keep their label; bare URLs get a short label", () => {
  const s = linkify("Hi [Get the deal](https://account.proton.me/lite?action=subscribe&coupon=X) or https://www.example.com/very/long/path/here?x=1.");
  assert.deepEqual(s, [
    { text: "Hi " },
    { href: "https://account.proton.me/lite?action=subscribe&coupon=X", label: "Get the deal" },
    { text: " or " },
    { href: "https://www.example.com/very/long/path/here?x=1", label: "example.com/very/long/path/he…" },
    { text: "." },
  ]);
});

test("non-http schemes are never turned into links", () => {
  for (const t of ["[x](javascript:alert(1))", "javascript:alert(1)", "data:text/html,hi", "[x](data:text/html,1)"]) {
    assert.ok(linkify(t).every((seg) => !("href" in seg)), t);
  }
});

test("plain text passes through untouched", () => {
  assert.deepEqual(linkify("no links here"), [{ text: "no links here" }]);
  assert.equal(shortUrl("https://proton.me/"), "proton.me");
});

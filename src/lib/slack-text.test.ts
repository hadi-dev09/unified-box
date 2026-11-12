import { test } from "node:test";
import assert from "node:assert/strict";
import { isRealMessage, mentionedUsers, slackTextToPlain, slackTsToIso } from "./slack-text.ts";

test("slackTextToPlain resolves mentions, channels, links and entities", () => {
  const names = { U1: "Ada Lovelace" };
  assert.equal(slackTextToPlain("hi <@U1> see <#C123|general> &amp; <https://x.io/a|the doc> <https://y.io>", names), "hi @Ada Lovelace see #general & the doc (https://x.io/a) https://y.io");
  assert.equal(slackTextToPlain("<!here> <!channel|channel> <!subteam^S1|@design>", {}), "@here @channel @design");
  assert.equal(slackTextToPlain("ping <@U9>", {}), "ping @U9");
  assert.equal(slackTextToPlain("mail <mailto:a@b.co|Ann> and <c@d.co>", {}), "mail Ann and c@d.co");
  assert.equal(slackTextToPlain("5 &lt; 6 &gt; 4", {}), "5 < 6 > 4");
});

test("mentionedUsers / isRealMessage / slackTsToIso", () => {
  assert.deepEqual(mentionedUsers("<@U1> and <@W2|bob> <#C1>"), ["U1", "W2"]);
  assert.equal(isRealMessage({ ts: "1", subtype: "channel_join" }), false);
  assert.equal(isRealMessage({ ts: "1", subtype: "bot_message" }), true);
  assert.equal(isRealMessage({}), false);
  assert.equal(slackTsToIso("1700000000.000200"), "2023-11-14T22:13:20.000Z");
});

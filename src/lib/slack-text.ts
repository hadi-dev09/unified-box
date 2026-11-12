// Pure helpers (no imports) for turning Slack mrkdwn into plain text. Unit-tested.

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">" };
const unescape = (s: string) => s.replace(/&(amp|lt|gt);/g, (_, e: string) => ENT[e]);

/** Converts Slack message text to readable plain text. `names` maps user IDs to display names. */
export function slackTextToPlain(text: string, names: Record<string, string> = {}): string {
  return unescape(
    text
      .replace(/<@([UW][A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id: string, label?: string) => `@${names[id] ?? label ?? id}`)
      .replace(/<#([CG][A-Z0-9]+)(?:\|([^>]*))?>/g, (_, id: string, name?: string) => `#${name ?? id}`)
      .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, "@$1")
      .replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]*))?>/g, (_, l?: string) => l ?? "@group")
      .replace(/<(mailto:)?([^>|]+@[^>|]+)(?:\|([^>]*))?>/g, (_, _m, addr: string, label?: string) => label ?? addr)
      .replace(/<(https?:\/\/[^>|]+)\|([^>]+)>/g, "$2 ($1)")
      .replace(/<(https?:\/\/[^>|]+)>/g, "$1"),
  ).trim();
}

/** Every user ID mentioned in a message body (so names can be resolved in one pass). */
export const mentionedUsers = (text: string): string[] => [...text.matchAll(/<@([UW][A-Z0-9]+)/g)].map((m) => m[1]);

const SKIP_SUBTYPES = new Set(["channel_join", "channel_leave", "channel_topic", "channel_purpose", "channel_name", "channel_archive", "channel_unarchive", "group_join", "group_leave", "pinned_item"]);
export const isRealMessage = (m: { subtype?: string; ts?: string }) => Boolean(m.ts) && !SKIP_SUBTYPES.has(m.subtype ?? "");

export const slackTsToIso = (ts: string) => new Date(Math.round(parseFloat(ts) * 1000)).toISOString();

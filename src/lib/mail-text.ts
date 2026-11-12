// Pure helpers (no imports) so they can be unit-tested with `node --test`.

const ENT: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", zwnj: "", zwj: "", bull: "•",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return m;
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

/** Converts an HTML email body to readable plain text. Output is only ever rendered as text, never as HTML. */
export function htmlToText(html: string): string {
  const s = html.slice(0, 500_000)
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote|section)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(s)
    .replace(/[ \t ​-‍⁠﻿͏]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseFrom(v: string): { name: string; addr: string } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), addr: m[2].trim() } : { name: "", addr: v.trim() };
}

const BULK_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];

/** True for newsletters, promos and system mail that doesn't deserve a "needs reply" flag. */
export function looksAutomated(o: { labels: string[]; fromAddr: string; listUnsubscribe?: string; precedence?: string; autoSubmitted?: string }): boolean {
  if (o.listUnsubscribe) return true;
  if (/^(bulk|list|junk)$/i.test((o.precedence ?? "").trim())) return true;
  const auto = (o.autoSubmitted ?? "").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (o.labels.some((l) => BULK_LABELS.includes(l))) return true;
  return /(^|[._+-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounces?)([._+@-]|$)/i.test(o.fromAddr.split("@")[0] + "@");
}

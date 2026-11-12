// Pure (no imports): splits message text into plain-text and link segments for safe rendering.
export type Segment = { text: string } | { href: string; label: string };

const RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'\])]+)/g;

/** Short, readable label for a bare URL: host + truncated path. */
export function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    const rest = (x.pathname + x.search).replace(/^\/$/, "");
    const host = x.host.replace(/^www\./, "");
    return rest.length > 18 ? `${host}${rest.slice(0, 18)}…` : host + rest;
  } catch {
    return u.slice(0, 40);
  }
}

export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i) });
    const href = (m[2] ?? m[3]).replace(/[.,;:!?]+$/, "");
    const trailing = (m[3] ?? "").slice(href.length); // punctuation stripped from a bare URL
    out.push({ href, label: m[1] ?? shortUrl(href) });
    if (trailing) out.push({ text: trailing });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

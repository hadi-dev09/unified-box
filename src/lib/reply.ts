// Pure helpers (no imports) for Reply / Reply all / Forward. Unit-tested.

export type Mode = "reply" | "reply_all" | "forward";
export type Msg = { from_addr: string | null; from_name?: string | null; to_addrs: string[] | null; cc_addrs?: string[] | null; is_outgoing: boolean; sent_at: string; subject?: string | null; body_text?: string | null };

export const isEmail = (a: string) => /^[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+$/.test(a);

function uniq(list: string[], exclude: string[]): string[] {
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  const out: string[] = [];
  for (const raw of list) {
    const a = raw.trim();
    const k = a.toLowerCase();
    if (!isEmail(a) || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/** Who a reply goes to, based on the latest message in the thread. */
export function replyRecipients(mode: Mode, msgs: Msg[], self: string): { to: string[]; cc: string[] } {
  if (mode === "forward" || !msgs.length) return { to: [], cc: [] };
  const last = [...msgs].sort((a, b) => a.sent_at.localeCompare(b.sent_at)).at(-1)!;
  const primary = last.is_outgoing ? (last.to_addrs ?? []) : [last.from_addr ?? ""];
  const to = uniq(primary, [self]);
  if (mode === "reply") return { to, cc: [] };
  const others = last.is_outgoing ? (last.cc_addrs ?? []) : [...(last.to_addrs ?? []), ...(last.cc_addrs ?? [])];
  return { to, cc: uniq(others, [self, ...to]) };
}

/** True when the conversation involves more than one other person (Reply all becomes relevant). */
export function isGroup(msgs: Msg[], self: string): boolean {
  const people = new Set<string>();
  for (const m of msgs) for (const a of [m.from_addr ?? "", ...(m.to_addrs ?? []), ...(m.cc_addrs ?? [])]) if (isEmail(a) && a.toLowerCase() !== self.toLowerCase()) people.add(a.toLowerCase());
  return people.size > 1;
}

export function replySubject(mode: Mode, subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (mode === "forward") return /^(fwd?|fw):/i.test(s) ? s : `Fwd: ${s}`.trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`.trim();
}

/** The quoted block added under a forwarded message. */
export function forwardBlock(m: Msg): string {
  return [
    "",
    "---------- Forwarded message ---------",
    `From: ${m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr ?? ""}`,
    `Date: ${new Date(m.sent_at).toUTCString()}`,
    `Subject: ${m.subject ?? ""}`,
    `To: ${(m.to_addrs ?? []).join(", ")}`,
    ...((m.cc_addrs ?? []).length ? [`Cc: ${(m.cc_addrs ?? []).join(", ")}`] : []),
    "",
    m.body_text ?? "",
  ].join("\n");
}

/** Parses a comma/semicolon/space separated address field. Returns valid and invalid entries. */
export function parseAddressField(v: string): { valid: string[]; invalid: string[] } {
  const parts = v.split(/[,;\s]+/).map((x) => x.trim().replace(/^<|>$/g, "")).filter(Boolean);
  return { valid: parts.filter(isEmail), invalid: parts.filter((p) => !isEmail(p)) };
}

// Pure matching logic (no imports) so it can be unit-tested.

export type Rule = { client_id: string; kind: "email" | "domain"; pattern: string };

export const normalizePattern = (kind: "email" | "domain", raw: string): string | null => {
  const v = raw.trim().toLowerCase().replace(/^@/, "");
  if (kind === "email") return /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(v) ? v : null;
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(v) ? v : null;
};

/** Exact email rules beat domain rules; a domain rule also matches its subdomains (mail.acme.com for acme.com). */
export function matchClient(rules: Rule[], addresses: string[]): string | null {
  const addrs = addresses.map((a) => a.trim().toLowerCase()).filter(Boolean);
  for (const a of addrs) {
    const hit = rules.find((r) => r.kind === "email" && r.pattern === a);
    if (hit) return hit.client_id;
  }
  for (const a of addrs) {
    const domain = a.split("@")[1];
    if (!domain) continue;
    const hit = rules.find((r) => r.kind === "domain" && (domain === r.pattern || domain.endsWith("." + r.pattern)));
    if (hit) return hit.client_id;
  }
  return null;
}

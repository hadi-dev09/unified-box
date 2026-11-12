import { matchClient, normalizePattern, type Rule } from "./client-match";
import { supabaseAdmin } from "./supabase/admin";

/** Rules for a user. Returns [] if the table doesn't exist yet (migration 0004 pending) so sync never breaks. */
export async function loadRules(userId: string): Promise<Rule[]> {
  const { data, error } = await supabaseAdmin().from("client_rules").select("client_id, kind, pattern").eq("user_id", userId);
  return error || !data ? [] : (data as Rule[]);
}

export async function createClientRecord(userId: string, name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean) return { ok: false, error: "Name required" };
  const { error } = await supabaseAdmin().from("clients").insert({ user_id: userId, name: clean });
  return error ? { ok: false, error: /duplicate|unique/i.test(error.message) ? "That client already exists" : error.message } : { ok: true };
}

export async function deleteClientRecord(userId: string, clientId: string) {
  const db = supabaseAdmin();
  await db.from("client_rules").delete().eq("user_id", userId).eq("client_id", clientId);
  await db.from("clients").delete().eq("user_id", userId).eq("id", clientId);
}

/** Adds a sender-email/domain rule and tags existing untagged threads that already match. */
export async function addRule(userId: string, clientId: string, kind: "email" | "domain", rawPattern: string) {
  const pattern = normalizePattern(kind, rawPattern);
  if (!pattern) return { ok: false, error: kind === "email" ? "Enter a full email address" : "Enter a domain like acme.com" };
  const db = supabaseAdmin();
  const { data: client } = await db.from("clients").select("id").eq("id", clientId).eq("user_id", userId).maybeSingle();
  if (!client) return { ok: false, error: "Client not found" };
  const { error } = await db.from("client_rules").insert({ user_id: userId, client_id: clientId, kind, pattern });
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? "Rule already exists" : error.message };
  await backfillThreads(userId, [{ client_id: clientId, kind, pattern }]);
  return { ok: true };
}

export async function deleteRule(userId: string, ruleId: string) {
  await supabaseAdmin().from("client_rules").delete().eq("id", ruleId).eq("user_id", userId);
}

/** Tags existing untagged threads whose messages involve a matching address. Never overwrites a client set by hand. */
export async function backfillThreads(userId: string, rules: Rule[]) {
  if (!rules.length) return;
  const db = supabaseAdmin();
  const { data: threads } = await db.from("threads").select("id").eq("user_id", userId).is("client_id", null).limit(2000);
  const ids = new Set<string>((threads ?? []).map((t: { id: string }) => t.id));
  if (!ids.size) return;
  const { data: msgs } = await db.from("messages").select("thread_id, from_addr, to_addrs").eq("user_id", userId).limit(10000);
  const byThread = new Map<string, string[]>();
  for (const m of msgs ?? []) if (ids.has(m.thread_id)) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m.from_addr ?? "", ...(m.to_addrs ?? [])]);
  for (const [threadId, addrs] of byThread) {
    const client = matchClient(rules, addrs);
    if (client) await db.from("threads").update({ client_id: client }).eq("id", threadId).eq("user_id", userId).is("client_id", null);
  }
}

export async function setThreadClient(userId: string, threadId: string, clientId: string | null) {
  const db = supabaseAdmin();
  if (clientId) {
    const { data: c } = await db.from("clients").select("id").eq("id", clientId).eq("user_id", userId).maybeSingle();
    if (!c) return { ok: false, error: "Client not found" };
  }
  await db.from("threads").update({ client_id: clientId }).eq("id", threadId).eq("user_id", userId);
  return { ok: true };
}

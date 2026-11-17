import { createHash, timingSafeEqual } from "node:crypto";
import { mapLimit } from "./gmail";
import { supabaseAdmin } from "./supabase/admin";
import { syncAccount } from "./sync";

/**
 * The background job (Supabase pg_cron, every minute) authenticates with a key that lives only inside the database
 * (Vault). We store just its SHA-256 here, so the key itself never sits in app config.
 */
export async function validCronKey(key: string | null) {
  if (!key || key.length < 32) return false;
  const { data } = await supabaseAdmin().from("internal_config").select("value").eq("name", "cron_key_sha256").maybeSingle();
  if (!data?.value) return false;
  const a = Buffer.from(createHash("sha256").update(key).digest("hex")), b = Buffer.from(String(data.value));
  return a.length === b.length && timingSafeEqual(a, b);
}

const DUE_MS = 50_000;
/** Slack pushes new messages in real time (Events API); polling is only a slow safety net because Slack allows apps like ours 1 history call per minute. */
export const dueAfterMs = (provider: string) => (provider === "slack" ? 10 * 60_000 : DUE_MS);

/** Syncs every connected account that wasn't synced in the last ~minute, and wakes snoozed conversations. */
export async function backgroundSync(budgetMs = 50_000) {
  const start = Date.now();
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  await db.from("threads").update({ snoozed_until: null, unread: true }).lte("snoozed_until", now);
  const { data } = await db.from("accounts").select("id, last_synced_at, provider").in("status", ["connected", "error"]);
  const due = (data ?? [])
    .filter((a: { last_synced_at: string | null; provider: string }) => a.provider !== "whatsapp" && (!a.last_synced_at || Date.now() - new Date(a.last_synced_at).getTime() > dueAfterMs(a.provider)))
    .sort((a: { last_synced_at: string | null }, b: { last_synced_at: string | null }) => String(a.last_synced_at ?? "").localeCompare(String(b.last_synced_at ?? "")));
  let done = 0;
  await mapLimit(due, 5, async (a: { id: string }) => {
    if (Date.now() - start > budgetMs) return;
    await syncAccount(a.id).catch(() => {});
    done++;
  });
  return { due: due.length, done };
}

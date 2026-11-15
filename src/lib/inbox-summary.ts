import { cache } from "react";
import { supabaseServer } from "./supabase/server";

export type SummaryAccount = { id: string; provider: string; display_name: string; account_type: string; status: string; status_detail: string | null; last_synced_at: string | null; can_send: boolean; external_id: string };

/** Sidebar + header data, computed once per request (shared by the layout and the inbox page). */
export const inboxSummary = cache(async () => {
  const sb = await supabaseServer();
  const [{ data: accountRows }, { count: pending }, { data: counts }, { data: clientRows }] = await Promise.all([
    sb.from("accounts").select("id, provider, display_name, account_type, status, status_detail, last_synced_at, can_send, external_id").order("display_name"),
    sb.from("drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("threads").select("account_id, client_id, unread, needs_reply").limit(5000),
    sb.from("clients").select("id, name").order("name"),
  ]);
  const perAcct: Record<string, number> = {}, perClient: Record<string, number> = {};
  let unreadTotal = 0, replyTotal = 0;
  for (const c of counts ?? []) {
    if (c.unread) { unreadTotal++; perAcct[c.account_id] = (perAcct[c.account_id] ?? 0) + 1; if (c.client_id) perClient[c.client_id] = (perClient[c.client_id] ?? 0) + 1; }
    if (c.needs_reply) replyTotal++;
  }
  const accounts = (accountRows ?? []) as SummaryAccount[];
  return {
    accounts, clients: (clientRows ?? []) as { id: string; name: string }[], pending: pending ?? 0,
    perAcct, perClient, unreadTotal, replyTotal,
    lastSynced: accounts.map((a) => a.last_synced_at).filter(Boolean).sort().pop() ?? null,
  };
});

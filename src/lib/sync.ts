import { supabaseAdmin } from "./supabase/admin";
import { getMessage, listIds, mapLimit, NeedsReauth, WINDOW_QUERY, type GmailMsg } from "./gmail";
import { loadRules } from "./clients";
import { syncSlack } from "./slack";
import { matchClient } from "./client-match";

export type SyncResult = { accountId: string; synced: number; unread?: number; changed?: boolean; error?: string; note?: string };

const seenAfter = (seenAt: string | null | undefined, at: string) => Boolean(seenAt) && new Date(seenAt!).getTime() >= new Date(at).getTime();

/**
 * Incremental Gmail sync. Each run:
 *  1. lists recent message ids, and separately the ids Gmail marks unread (authoritative unread state),
 *  2. downloads only messages not stored yet,
 *  3. updates unread flags on existing threads when they change (e.g. read elsewhere).
 * Opening a thread in Unified Box keeps it read until a newer message arrives. Failures set a visible status.
 */
export async function syncAccount(accountId: string): Promise<SyncResult> {
  const db = supabaseAdmin();
  const { data: acct } = await db.from("accounts").select("*").eq("id", accountId).single();
  if (!acct) return { accountId, synced: 0 };
  if (acct.provider === "slack") return syncSlack(accountId);
  if (acct.provider !== "gmail") return { accountId, synced: 0 };

  try {
    const [all, unreadList] = await Promise.all([
      listIds(accountId, WINDOW_QUERY, 100),
      listIds(accountId, `is:unread ${WINDOW_QUERY}`, 200),
    ]);
    const unreadIds = new Set(unreadList.map((x) => x.id));
    const threadIdsOf = new Map<string, string[]>();
    for (const m of all) threadIdsOf.set(m.threadId, [...(threadIdsOf.get(m.threadId) ?? []), m.id]);
    const gmailUnread = (threadExt: string) => (threadIdsOf.get(threadExt) ?? []).some((id) => unreadIds.has(id));

    const { data: existing } = all.length
      ? await db.from("messages").select("external_id").eq("account_id", accountId).in("external_id", all.map((m) => m.id))
      : { data: [] };
    const known = new Set((existing ?? []).map((m: { external_id: string }) => m.external_id));
    const fresh = all.filter((m) => !known.has(m.id));
    const msgs: GmailMsg[] = await mapLimit(fresh, 6, (m) => getMessage(accountId, m.id, acct.external_id));

    const rules = msgs.length ? await loadRules(acct.user_id) : [];
    const byThread = new Map<string, GmailMsg[]>();
    for (const m of msgs) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);
    let changed = msgs.length > 0;

    for (const [ext, list] of byThread) {
      list.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      const last = list[list.length - 1];
      const { data: prev } = await db.from("threads").select("id, last_message_at, seen_at").eq("account_id", accountId).eq("external_id", ext).maybeSingle();
      const isNewest = !prev || new Date(last.sentAt).getTime() >= new Date(prev.last_message_at).getTime();
      const unread = (gmailUnread(ext) || list.some((m) => m.unread)) && !seenAfter(prev?.seen_at, last.sentAt);
      const { data: t, error } = await db.from("threads").upsert(
        {
          user_id: acct.user_id, account_id: accountId, external_id: ext, unread,
          ...(isNewest ? {
            subject: last.subject, snippet: last.snippet, last_message_at: last.sentAt,
            needs_reply: !last.outgoing && !last.automated, last_from: last.outgoing ? "You" : last.fromName || last.fromAddr,
          } : {}),
        },
        { onConflict: "account_id,external_id" },
      ).select("id, client_id").single();
      if (error || !t) throw new Error(error?.message ?? "thread upsert failed");
      if (!t.client_id && rules.length) {
        const client = matchClient(rules, list.flatMap((m) => [m.fromAddr, ...m.to, ...m.cc]).filter((a) => a.toLowerCase() !== acct.external_id.toLowerCase()));
        if (client) await db.from("threads").update({ client_id: client }).eq("id", t.id).is("client_id", null);
      }
      const { error: e2 } = await db.from("messages").upsert(
        list.map((m) => ({
          user_id: acct.user_id, account_id: accountId, thread_id: t.id, external_id: m.id,
          from_addr: m.fromAddr, from_name: m.fromName, to_addrs: m.to, subject: m.subject,
          body_text: m.body, sent_at: m.sentAt, is_outgoing: m.outgoing, cc_addrs: m.cc, rfc_message_id: m.messageId || null,
        })),
        { onConflict: "account_id,external_id" },
      );
      if (e2) throw new Error(e2.message);
    }

    // Unread changes on threads that got no new message (read/unread elsewhere, e.g. on your phone).
    const untouched = [...threadIdsOf.keys()].filter((ext) => !byThread.has(ext));
    if (untouched.length) {
      const { data: rows } = await db.from("threads").select("id, external_id, unread, seen_at, last_message_at").eq("account_id", accountId).in("external_id", untouched);
      for (const r of (rows ?? []) as { id: string; external_id: string; unread: boolean; seen_at: string | null; last_message_at: string }[]) {
        const want = gmailUnread(r.external_id) && !seenAfter(r.seen_at, r.last_message_at);
        if (want !== r.unread) { await db.from("threads").update({ unread: want }).eq("id", r.id); changed = true; }
      }
    }

    await db.from("accounts").update({ status: "connected", status_detail: null, last_synced_at: new Date().toISOString() }).eq("id", accountId);
    return { accountId, synced: msgs.length, unread: unreadIds.size, changed };
  } catch (e) {
    const reauth = e instanceof NeedsReauth;
    await db.from("accounts").update({ status: reauth ? "needs_reauth" : "error", status_detail: String((e as Error).message).slice(0, 300) }).eq("id", accountId);
    return { accountId, synced: 0, error: (e as Error).message };
  }
}

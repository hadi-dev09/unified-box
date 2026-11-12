import { supabaseAdmin } from "./supabase/admin";
import { NeedsReauth, recentMessages } from "./gmail";

/** Pulls recent Gmail into the DB for one account. Failures set a visible account status; never silent. */
export async function syncAccount(accountId: string) {
  const db = supabaseAdmin();
  const { data: acct } = await db.from("accounts").select("*").eq("id", accountId).single();
  if (!acct || acct.provider !== "gmail") return { accountId, synced: 0 };

  try {
    const msgs = await recentMessages(accountId, acct.external_id);
    const byThread = new Map<string, typeof msgs>();
    for (const m of msgs) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m]);

    for (const [ext, list] of byThread) {
      list.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      const last = list[list.length - 1];
      const { data: t, error } = await db
        .from("threads")
        .upsert(
          {
            user_id: acct.user_id, account_id: accountId, external_id: ext,
            subject: last.subject, snippet: last.snippet, last_message_at: last.sentAt,
            unread: list.some((m) => m.unread), needs_reply: !last.outgoing && !last.automated,
            last_from: last.outgoing ? "You" : last.fromName || last.fromAddr,
          },
          { onConflict: "account_id,external_id" },
        )
        .select("id")
        .single();
      if (error || !t) throw new Error(error?.message ?? "thread upsert failed");
      const { error: e2 } = await db.from("messages").upsert(
        list.map((m) => ({
          user_id: acct.user_id, account_id: accountId, thread_id: t.id, external_id: m.id,
          from_addr: m.fromAddr, from_name: m.fromName, to_addrs: m.to, subject: m.subject,
          body_text: m.body, sent_at: m.sentAt, is_outgoing: m.outgoing,
        })),
        { onConflict: "account_id,external_id" },
      );
      if (e2) throw new Error(e2.message);
    }
    await db.from("accounts").update({ status: "connected", status_detail: null, last_synced_at: new Date().toISOString() }).eq("id", accountId);
    return { accountId, synced: msgs.length };
  } catch (e) {
    const reauth = e instanceof NeedsReauth;
    await db.from("accounts").update({ status: reauth ? "needs_reauth" : "error", status_detail: String((e as Error).message).slice(0, 300) }).eq("id", accountId);
    return { accountId, synced: 0, error: (e as Error).message };
  }
}

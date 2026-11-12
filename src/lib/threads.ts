import { supabaseAdmin } from "./supabase/admin";

/** Marks a thread read inside Unified Box (works even with read-only Gmail access). */
export async function markSeen(userId: string, threadId: string) {
  await supabaseAdmin().from("threads").update({ unread: false, seen_at: new Date().toISOString() }).eq("id", threadId).eq("user_id", userId);
}

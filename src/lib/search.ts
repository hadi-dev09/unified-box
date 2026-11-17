import type { SupabaseClient } from "@supabase/supabase-js";

/** Cleans a search box value for use in a PostgREST ilike filter. */
export const cleanQuery = (q: string | null | undefined) => (q ?? "").replace(/[%,()*_\\:."']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);

/** Thread ids whose subject/snippet/sender OR any message body matches (RLS keeps it to the user's own data). */
export async function matchingThreadIds(sb: SupabaseClient, userId: string, q: string, limit = 200): Promise<string[]> {
  const [{ data: t }, { data: m }] = await Promise.all([
    sb.from("threads").select("id").eq("user_id", userId).or(`subject.ilike.%${q}%,snippet.ilike.%${q}%,last_from.ilike.%${q}%`).is("trashed_at", null).order("last_message_at", { ascending: false }).limit(limit),
    sb.from("messages").select("thread_id").eq("user_id", userId).or(`body_text.ilike.%${q}%,from_name.ilike.%${q}%,from_addr.ilike.%${q}%`).order("sent_at", { ascending: false }).limit(limit),
  ]);
  return [...new Set([...(t ?? []).map((x: { id: string }) => x.id), ...(m ?? []).map((x: { thread_id: string }) => x.thread_id)])];
}

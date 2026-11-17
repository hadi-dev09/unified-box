import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { cleanQuery, matchingThreadIds } from "@/lib/search";
import { supabaseServer } from "@/lib/supabase/server";

// Quick results for the search dropdown (top matches only).
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = cleanQuery(req.nextUrl.searchParams.get("q"));
  if (q.length < 2) return NextResponse.json({ results: [] });
  const sb = await supabaseServer();
  const ids = (await matchingThreadIds(sb, user.id, q, 40)).slice(0, 40);
  if (!ids.length) return NextResponse.json({ results: [], total: 0 });
  const { data } = await sb.from("threads").select("id, subject, snippet, last_from, last_message_at, unread, accounts(provider, display_name, label)").in("id", ids).eq("user_id", user.id).is("trashed_at", null).order("last_message_at", { ascending: false }).limit(4);
  return NextResponse.json({ results: data ?? [], total: ids.length });
}

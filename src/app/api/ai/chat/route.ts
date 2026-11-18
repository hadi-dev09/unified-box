import { NextRequest, NextResponse } from "next/server";
import { runInboxChat } from "@/lib/ai-assist";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

// The in-app AI bubble: ask about the open conversation, or about your whole inbox. Read-only; never sends.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { question?: unknown; thread_id?: unknown };
  const question = typeof b.question === "string" ? b.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Ask something first" }, { status: 400 });
  const db = supabaseAdmin();
  const tid = typeof b.thread_id === "string" && b.thread_id ? b.thread_id : null;
  let r;
  if (tid) {
    const { data: t } = await db.from("threads").select("id, subject, accounts(provider)").eq("id", tid).eq("user_id", user.id).maybeSingle();
    if (!t) return NextResponse.json({ error: "conversation not found" }, { status: 404 });
    const { data: msgs } = await db.from("messages").select("from_name, from_addr, is_outgoing, sent_at, body_text").eq("thread_id", t.id).eq("user_id", user.id).order("sent_at").limit(60);
    r = await runInboxChat(user.id, { question, thread: { provider: (t.accounts as unknown as { provider: string } | null)?.provider ?? "gmail", subject: t.subject ?? "", messages: msgs ?? [] } });
  } else {
    const { data: rows } = await db.from("threads").select("subject, snippet, last_from, last_message_at, unread, needs_reply, accounts(provider, display_name, label)")
      .eq("user_id", user.id).is("trashed_at", null).is("snoozed_until", null).order("last_message_at", { ascending: false }).limit(60);
    const overview = ((rows ?? []) as unknown as { subject: string | null; snippet: string | null; last_from: string | null; last_message_at: string; unread: boolean; needs_reply: boolean; accounts: { provider: string; display_name: string; label: string | null } | null }[])
      .map((t) => ({ when: t.last_message_at, channel: `${t.accounts?.provider ?? ""}:${t.accounts?.label || t.accounts?.display_name || ""}`, from: t.last_from ?? "", subject: t.subject ?? "", snippet: t.snippet ?? "", unread: t.unread, needsReply: t.needs_reply }));
    r = await runInboxChat(user.id, { question, overview });
  }
  return NextResponse.json(r, { status: r.ok ? 200 : r.needsKey ? 412 : 502 });
}

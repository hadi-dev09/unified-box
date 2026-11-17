import { NextRequest, NextResponse } from "next/server";
import { AI_TASKS, runAssist, type AiTask } from "@/lib/ai-assist";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

// Drafts, improves or summarizes using the signed-in user's own Claude key. Returns text only; it never sends anything.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { thread_id?: unknown; task?: unknown; instructions?: unknown; text?: unknown };
  const task = String(b.task) as AiTask;
  if (!AI_TASKS.includes(task)) return NextResponse.json({ error: "Unknown task" }, { status: 400 });
  const instructions = typeof b.instructions === "string" ? b.instructions.slice(0, 1000) : undefined;
  const text = typeof b.text === "string" ? b.text.slice(0, 20_000) : undefined;
  if (task === "improve" && !text?.trim()) return NextResponse.json({ error: "Write something first, then ask AI to improve it." }, { status: 400 });

  const db = supabaseAdmin();
  const { data: t } = await db.from("threads").select("id, subject, accounts(provider)").eq("id", String(b.thread_id ?? "")).eq("user_id", user.id).maybeSingle();
  if (!t) return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  const { data: msgs } = await db.from("messages").select("from_name, from_addr, is_outgoing, sent_at, body_text").eq("thread_id", t.id).eq("user_id", user.id).order("sent_at").limit(60);
  const r = await runAssist(user.id, {
    task, provider: (t.accounts as unknown as { provider: string } | null)?.provider ?? "gmail", subject: t.subject ?? "",
    messages: msgs ?? [], instructions, text,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : r.needsKey ? 412 : 502 });
}

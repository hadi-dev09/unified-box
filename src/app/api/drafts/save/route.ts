import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MODES = ["reply", "reply_all", "forward"];
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 254)).filter(Boolean).slice(0, 50) : []);

/**
 * Auto-save of a reply you're writing (never sends). One saved draft per conversation: the same draft is updated
 * as you type, so leaving the page loses nothing. Sending or discarding removes it.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const body = typeof b.body === "string" ? b.body.slice(0, 20_000) : "";
  if (!body.trim()) return NextResponse.json({ error: "empty" }, { status: 400 });
  const db = supabaseAdmin();
  const { data: t } = await db.from("threads").select("id, account_id, subject").eq("id", String(b.thread_id ?? "")).eq("user_id", user.id).maybeSingle();
  if (!t) return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  const row = {
    mode: MODES.includes(String(b.mode)) ? String(b.mode) : "reply",
    to_addrs: strList(b.to), cc_addrs: strList(b.cc),
    subject: (typeof b.subject === "string" && b.subject.trim() ? b.subject : t.subject || "Draft").replace(/[\r\n]+/g, " ").slice(0, 300),
    body,
  };
  // Update this conversation's existing saved draft (if any) instead of piling up copies.
  const { data: existing } = await db.from("drafts").select("id").eq("user_id", user.id).eq("thread_id", t.id).eq("status", "pending").eq("created_by", "user").is("send_at", null).limit(1).maybeSingle();
  if (existing) {
    await db.from("drafts").update(row).eq("id", existing.id).eq("user_id", user.id);
    return NextResponse.json({ ok: true, draft_id: existing.id });
  }
  const { data: d, error } = await db.from("drafts").insert({ user_id: user.id, account_id: t.account_id, thread_id: t.id, created_by: "user", status: "pending", ...row }).select("id").single();
  if (error || !d) return NextResponse.json({ error: "could not save" }, { status: 500 });
  return NextResponse.json({ ok: true, draft_id: d.id });
}

/** Discard your saved draft for a conversation. */
export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const threadId = req.nextUrl.searchParams.get("thread_id") ?? "";
  await supabaseAdmin().from("drafts").delete().eq("user_id", user.id).eq("thread_id", threadId).eq("status", "pending").eq("created_by", "user").is("send_at", null);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { canReply, isEmailProvider, type ProviderId } from "@/lib/providers";
import { replyRecipients, replySubject, type Msg } from "@/lib/reply";
import { decideDraft } from "@/lib/send";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * One-tap reply from the AI assistant card. The person presses Send (or Save as draft) themselves; recipients and
 * subject are worked out like the Reply button does. AI tokens can't reach this route.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { thread_id?: unknown; body?: unknown; action?: unknown };
  const text = typeof b.body === "string" ? b.body.trim().slice(0, 20_000) : "";
  if (!text) return NextResponse.json({ error: "Write a message first" }, { status: 400 });
  const action = b.action === "draft" ? "draft" : "send";
  const db = supabaseAdmin();
  const { data: t } = await db.from("threads").select("id, account_id, subject, accounts(provider, external_id, can_send)").eq("id", String(b.thread_id ?? "")).eq("user_id", user.id).maybeSingle();
  if (!t) return NextResponse.json({ error: "conversation not found" }, { status: 404 });
  const acct = t.accounts as unknown as { provider: ProviderId; external_id: string; can_send: boolean } | null;
  if (!acct || !canReply(acct.provider)) return NextResponse.json({ error: "Replying isn't available for this conversation." }, { status: 400 });
  if (action === "send" && !acct.can_send) return NextResponse.json({ error: "This account is read-only. Reconnect it with sending in Settings." }, { status: 400 });

  let to: string[] = [], cc: string[] = [], subject = t.subject || "Chat";
  if (isEmailProvider(acct.provider)) {
    const { data: msgs } = await db.from("messages").select("from_addr, from_name, to_addrs, cc_addrs, is_outgoing, sent_at, subject").eq("thread_id", t.id).eq("user_id", user.id).order("sent_at");
    ({ to, cc } = replyRecipients("reply", (msgs ?? []) as Msg[], acct.external_id));
    if (!to.length) return NextResponse.json({ error: "Couldn't work out who to reply to. Open the conversation and reply there." }, { status: 400 });
    subject = replySubject("reply", t.subject);
  }
  // Replace any saved draft for this conversation.
  await db.from("drafts").delete().eq("user_id", user.id).eq("thread_id", t.id).eq("status", "pending").eq("created_by", "user").is("send_at", null);
  const { data: d, error } = await db.from("drafts").insert({ user_id: user.id, account_id: t.account_id, thread_id: t.id, mode: "reply", to_addrs: to, cc_addrs: cc, subject, body: text, created_by: "user" }).select("id").single();
  if (error || !d) return NextResponse.json({ error: "could not save" }, { status: 500 });
  if (action === "draft") return NextResponse.json({ status: "draft", draft_id: d.id });
  const r = await decideDraft(user.id, d.id, "approve");
  return NextResponse.json({ ...r.body, to }, { status: r.status });
}

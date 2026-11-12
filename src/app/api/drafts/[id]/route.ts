import { NextRequest, NextResponse } from "next/server";
import { sendMail } from "@/lib/gmail";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

// The ONLY path that sends mail. Requires a signed-in human; Claude's MCP key cannot reach this route.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { action, subject, body } = (await req.json().catch(() => ({}))) as { action?: string; subject?: unknown; body?: unknown };
  if (action !== "approve" && action !== "reject") return NextResponse.json({ error: "bad action" }, { status: 400 });

  // The human may edit the text while approving; what they approved is exactly what gets sent.
  const edits: { subject?: string; body?: string } = {};
  if (action === "approve") {
    if (body !== undefined) {
      if (typeof body !== "string" || !body.trim() || body.length > 10_000) return NextResponse.json({ error: "invalid body" }, { status: 400 });
      edits.body = body;
    }
    if (subject !== undefined) {
      if (typeof subject !== "string") return NextResponse.json({ error: "invalid subject" }, { status: 400 });
      const clean = subject.replace(/[\r\n]+/g, " ").trim();
      if (!clean || clean.length > 300) return NextResponse.json({ error: "invalid subject" }, { status: 400 });
      edits.subject = clean;
    }
  }

  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseAdmin();
  // Atomic pending -> approved/rejected transition prevents double-send on double click.
  const { data: d } = await db
    .from("drafts")
    .update({ status: action === "approve" ? "approved" : "rejected", decided_at: new Date().toISOString(), ...edits })
    .eq("id", id).eq("user_id", user.id).eq("status", "pending")
    .select("*").maybeSingle();
  if (!d) return NextResponse.json({ error: "draft not found or already decided" }, { status: 404 });

  await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: `draft.${action}`, target: id, meta: { to: d.to_addrs, created_by: d.created_by, edited: Object.keys(edits).length > 0 } });
  if (action === "reject") return NextResponse.json({ status: "rejected" });

  const { data: acct } = await db.from("accounts").select("external_id, can_send").eq("id", d.account_id).single();
  try {
    const badRecipient = (d.to_addrs as string[]).find((a) => !/^[^\s<>,;"]+@[^\s<>,;"]+$/.test(a));
    if (badRecipient) throw new Error(`Invalid recipient address: ${badRecipient.slice(0, 80)}`);
    if (!acct?.can_send) throw new Error("This account was connected read-only. Reconnect it with sending enabled.");
    let threadExt: string | undefined;
    if (d.thread_id) threadExt = (await db.from("threads").select("external_id").eq("id", d.thread_id).single()).data?.external_id;
    await sendMail(d.account_id, acct.external_id, d.to_addrs, d.subject, d.body, threadExt);
    await db.from("drafts").update({ status: "sent" }).eq("id", id);
    await db.from("audit_log").insert({ user_id: user.id, actor: "system", action: "draft.sent", target: id });
    return NextResponse.json({ status: "sent" });
  } catch (e) {
    await db.from("drafts").update({ status: "failed", error: (e as Error).message.slice(0, 300) }).eq("id", id);
    return NextResponse.json({ status: "failed", error: (e as Error).message }, { status: 502 });
  }
}

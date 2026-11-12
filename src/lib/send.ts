import { sendMail } from "./gmail";
import { isEmail } from "./reply";
import { supabaseAdmin } from "./supabase/admin";

export type Edits = { subject?: string; body?: string };
type Result = { status: number; body: Record<string, unknown> };

/** Validates human edits to a draft. Returns an error message or the cleaned edits. */
export function validateEdits(subject: unknown, body: unknown): { error: string } | { edits: Edits } {
  const edits: Edits = {};
  if (body !== undefined) {
    if (typeof body !== "string" || !body.trim() || body.length > 20_000) return { error: "invalid body" };
    edits.body = body;
  }
  if (subject !== undefined) {
    if (typeof subject !== "string") return { error: "invalid subject" };
    const clean = subject.replace(/[\r\n]+/g, " ").trim();
    if (!clean || clean.length > 300) return { error: "invalid subject" };
    edits.subject = clean;
  }
  return { edits };
}

/**
 * The ONLY code path that sends mail. Callers must have verified a signed-in human (never an AI token).
 * Atomically moves a pending draft to approved/rejected so a double click can't send twice.
 */
export async function decideDraft(userId: string, draftId: string, action: "approve" | "reject", edits: Edits = {}): Promise<Result> {
  const db = supabaseAdmin();
  const { data: d } = await db
    .from("drafts")
    .update({ status: action === "approve" ? "approved" : "rejected", decided_at: new Date().toISOString(), ...(action === "approve" ? edits : {}) })
    .eq("id", draftId).eq("user_id", userId).eq("status", "pending")
    .select("*").maybeSingle();
  if (!d) return { status: 404, body: { error: "draft not found or already decided" } };

  await db.from("audit_log").insert({ user_id: userId, actor: "user", action: `draft.${action}`, target: draftId, meta: { to: d.to_addrs, cc: d.cc_addrs ?? [], created_by: d.created_by, mode: d.mode, edited: Object.keys(edits).length > 0 } });
  if (action === "reject") return { status: 200, body: { status: "rejected" } };

  const { data: acct } = await db.from("accounts").select("external_id, can_send, provider").eq("id", d.account_id).single();
  try {
    const recipients = [...(d.to_addrs as string[]), ...((d.cc_addrs as string[] | null) ?? [])];
    const bad = recipients.find((a) => !isEmail(a));
    if (bad) throw new Error(`Invalid recipient address: ${bad.slice(0, 80)}`);
    if (!(d.to_addrs as string[]).length) throw new Error("Add at least one recipient");
    if (recipients.length > 50) throw new Error("Too many recipients (max 50)");
    if (acct?.provider !== "gmail") throw new Error("Sending is only available for Gmail accounts right now.");
    if (!acct?.can_send) throw new Error("This account was connected read-only. Reconnect it with sending enabled.");

    // Keep replies in the same conversation (Gmail threadId + standard In-Reply-To/References headers).
    let threadId: string | undefined, inReplyTo: string | undefined, references: string[] = [];
    if (d.thread_id && d.mode !== "forward") {
      threadId = (await db.from("threads").select("external_id").eq("id", d.thread_id).eq("user_id", userId).single()).data?.external_id;
      const { data: msgs } = await db.from("messages").select("rfc_message_id, sent_at").eq("thread_id", d.thread_id).eq("user_id", userId).order("sent_at");
      references = (msgs ?? []).map((m: { rfc_message_id: string | null }) => m.rfc_message_id).filter(Boolean) as string[];
      inReplyTo = references.at(-1);
    }
    await sendMail(d.account_id, { from: acct.external_id, to: d.to_addrs, cc: d.cc_addrs ?? [], subject: d.subject, body: d.body, threadId, inReplyTo, references });
    await db.from("drafts").update({ status: "sent" }).eq("id", draftId);
    await db.from("audit_log").insert({ user_id: userId, actor: "system", action: "draft.sent", target: draftId });
    return { status: 200, body: { status: "sent" } };
  } catch (e) {
    await db.from("drafts").update({ status: "failed", error: (e as Error).message.slice(0, 300) }).eq("id", draftId);
    return { status: 502, body: { status: "failed", error: (e as Error).message } };
  }
}

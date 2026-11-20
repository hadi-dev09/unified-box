import { type GmailMsg, sendMail } from "./gmail";
import { canReply, isEmailProvider, provider as providerInfo, type ProviderId } from "./providers";
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
  return deliverDraft(userId, d);
}

/** Sends a draft that has already been claimed (approved, or a scheduled one whose time came). */
async function deliverDraft(userId: string, d: Record<string, any>): Promise<Result> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin();
  const draftId = d.id as string;
  const { data: acct } = await db.from("accounts").select("id, user_id, external_id, can_send, provider").eq("id", d.account_id).single();
  try {
    const prov = acct?.provider as ProviderId | undefined;
    if (!acct || !prov) throw new Error("This account is no longer connected.");
    if (!canReply(prov)) throw new Error(`Replying isn't available for ${providerInfo(prov)?.name ?? prov} yet. Open it in the original app to reply.`);
    if (!acct.can_send) throw new Error("This account was connected read-only. Reconnect it with sending enabled.");

    if (isEmailProvider(prov)) {
      const recipients = [...(d.to_addrs as string[]), ...((d.cc_addrs as string[] | null) ?? [])];
      const bad = recipients.find((a) => !isEmail(a));
      if (bad) throw new Error(`Invalid recipient address: ${bad.slice(0, 80)}`);
      if (!(d.to_addrs as string[]).length) throw new Error("Add at least one recipient");
      if (recipients.length > 50) throw new Error("Too many recipients (max 50)");

      // Keep replies in the same conversation (provider thread id + standard In-Reply-To/References headers).
      let threadId: string | undefined, inReplyTo: string | undefined, references: string[] = [], lastExternal: string | undefined;
      if (d.thread_id && (prov === "outlook" || d.mode !== "forward")) {
        threadId = (await db.from("threads").select("external_id").eq("id", d.thread_id).eq("user_id", userId).single()).data?.external_id;
        const { data: msgs } = await db.from("messages").select("external_id, rfc_message_id, sent_at").eq("thread_id", d.thread_id).eq("user_id", userId).order("sent_at");
        references = (msgs ?? []).map((m: { rfc_message_id: string | null }) => m.rfc_message_id).filter(Boolean) as string[];
        inReplyTo = references.at(-1);
        lastExternal = (msgs ?? []).at(-1)?.external_id;
      }
      if (prov === "gmail" && d.mode === "forward") threadId = undefined; // a forward starts a new Gmail thread
      const mail = { from: acct.external_id, to: d.to_addrs, cc: d.cc_addrs ?? [], subject: d.subject, body: d.body, threadId, inReplyTo, references };
      if (prov === "imap") {
        const { imapSend } = await import("./imap");
        const sent = await imapSend(d.account_id, mail);
        // IMAP sync reads only the inbox, so record the sent reply in its conversation now.
        const now = new Date().toISOString();
        const ext = d.mode === "forward" || !threadId ? `t:${sent.id}` : threadId;
        const { storeConversation } = await import("./sync");
        const { loadRules } = await import("./clients");
        await storeConversation(acct, ext, [{ id: `sent:${sent.id}`, threadId: ext, subject: d.subject, fromName: "You", fromAddr: acct.external_id, to: d.to_addrs, cc: d.cc_addrs ?? [], messageId: sent.id ?? "", body: d.body, sentAt: now, snippet: String(d.body).slice(0, 160), unread: false, outgoing: true, automated: false }], false, await loadRules(userId));
      } else if (prov === "outlook") {
        const { outlookSend } = await import("./outlook");
        await outlookSend(d.account_id, { ...mail, replyToId: lastExternal, mode: d.mode });
      } else await sendMail(d.account_id, mail);
      // Pull the sent message into the conversation right away.
      const { syncAccount } = await import("./sync");
      await syncAccount(d.account_id).catch(() => null);
    } else {
      // Chat apps: the message goes back into the same chat; no recipients or subject.
      if (!d.thread_id) throw new Error("Pick a conversation to reply in.");
      const { data: t } = await db.from("threads").select("external_id, subject").eq("id", d.thread_id).eq("user_id", userId).single();
      if (!t) throw new Error("conversation not found");
      const text = String(d.body).slice(0, prov === "slack" ? 12_000 : 4096);
      let sentId: string;
      if (prov === "whatsapp") {
        const { waSend } = await import("./whatsapp");
        sentId = (await waSend(d.account_id, acct.external_id, t.external_id, text)).id;
      } else if (prov === "telegram") {
        const { telegramSend } = await import("./telegram");
        sentId = `${t.external_id}:${(await telegramSend(d.account_id, t.external_id, text)).id}`;
      } else if (prov === "whatsapp_web") {
        const { gwSendText } = await import("./wa-gateway");
        sentId = (await gwSendText(acct.external_id, t.external_id, text)).id;
      } else if (prov === "slack") {
        const { slackSend, splitSlackExt, slackThreadKey, slackThreadTitle } = await import("./slack");
        // A thread conversation always replies in its thread; a channel reply can target a thread too ("Reply in thread").
        const { channel, threadTs } = splitSlackExt(t.external_id);
        const replyTo = threadTs ?? ((d.reply_to as string | null) ?? null);
        sentId = `${channel}:${(await slackSend(d.account_id, channel, text, replyTo)).ts}`;
        if (replyTo && !threadTs) { t.external_id = slackThreadKey(channel, replyTo); t.subject = slackThreadTitle(t.subject ?? ""); }
        d.reply_to = replyTo;
      } else throw new Error("Unsupported account");
      // Show the sent message in the conversation right away.
      const now = new Date().toISOString();
      const out: GmailMsg = { id: sentId, threadId: t.external_id, subject: t.subject ?? "", fromName: "You", fromAddr: acct.external_id, to: [t.external_id], cc: [], messageId: "", body: text, sentAt: now, snippet: text.slice(0, 160), unread: false, outgoing: true, automated: false };
      const { storeConversation } = await import("./sync");
      const { loadRules } = await import("./clients");
      await storeConversation(acct, t.external_id, [out], false, await loadRules(userId), t.subject ?? undefined);
      if (prov === "slack" && d.reply_to) await db.from("messages").update({ thread_ts: d.reply_to }).eq("account_id", d.account_id).eq("external_id", sentId);
    }
    await db.from("drafts").update({ status: "sent" }).eq("id", draftId);
    await db.from("audit_log").insert({ user_id: userId, actor: "system", action: "draft.sent", target: draftId });
    return { status: 200, body: { status: "sent" } };
  } catch (e) {
    await db.from("drafts").update({ status: "failed", error: (e as Error).message.slice(0, 300) }).eq("id", draftId);
    return { status: 502, body: { status: "failed", error: (e as Error).message } };
  }
}

/** A human-written reply to send later. Validation already happened in the compose route. */
export function validSendAt(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = new Date(v);
  if (Number.isNaN(t.getTime()) || t.getTime() < Date.now() + 30_000 || t.getTime() > Date.now() + 366 * 86400_000) return null;
  return t.toISOString();
}

/** Cancel a scheduled reply (it goes back to nothing) or send it right now. Only the owner, only while still scheduled. */
export async function decideScheduled(userId: string, draftId: string, action: "cancel" | "send_now"): Promise<Result> {
  const db = supabaseAdmin();
  const { data: d } = await db.from("drafts")
    .update({ status: action === "cancel" ? "rejected" : "sending", decided_at: new Date().toISOString() })
    .eq("id", draftId).eq("user_id", userId).eq("status", "scheduled")
    .select("*").maybeSingle();
  if (!d) return { status: 404, body: { error: "scheduled message not found, or already sent" } };
  await db.from("audit_log").insert({ user_id: userId, actor: "user", action: `scheduled.${action}`, target: draftId });
  if (action === "cancel") return { status: 200, body: { status: "cancelled" } };
  return deliverDraft(userId, d);
}

/** Background job: sends every scheduled reply whose time has come. Each is claimed atomically so it goes out once. */
export async function sendDueScheduled(limit = 25) {
  const db = supabaseAdmin();
  const { data: due } = await db.from("drafts").select("id, user_id").eq("status", "scheduled").lte("send_at", new Date().toISOString()).order("send_at").limit(limit);
  let sent = 0;
  for (const row of (due ?? []) as { id: string; user_id: string }[]) {
    const { data: d } = await db.from("drafts").update({ status: "sending", decided_at: new Date().toISOString() }).eq("id", row.id).eq("status", "scheduled").select("*").maybeSingle();
    if (!d) continue; // someone else (or "send now") got it first
    const r = await deliverDraft(row.user_id, d);
    if (r.status === 200) sent++;
  }
  return { due: (due ?? []).length, sent };
}

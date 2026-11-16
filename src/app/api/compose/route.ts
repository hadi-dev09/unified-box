import { NextRequest, NextResponse } from "next/server";
import { canReply, isEmailProvider, provider, type ProviderId } from "@/lib/providers";
import { isEmail } from "@/lib/reply";
import { decideDraft, validateEdits } from "@/lib/send";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

const MODES = ["reply", "reply_all", "forward"] as const;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Reply / Reply all / Forward written by the signed-in human. `send: true` sends now (the human wrote it,
 * so it doesn't wait in Approvals); `send: false` saves it to Approvals. AI tokens can't reach this route.
 */
export async function POST(req: NextRequest) {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return bad("unauthorized", 401);

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return bad("invalid request");
  const db = supabaseAdmin();
  const { data: t } = await db.from("threads").select("id, account_id, subject, accounts(provider, can_send)").eq("id", String(b.thread_id ?? "")).eq("user_id", user.id).maybeSingle();
  if (!t) return bad("conversation not found", 404);
  const acct = t.accounts as unknown as { provider: ProviderId; can_send: boolean } | null;
  if (!acct || !canReply(acct.provider)) return bad(`Replying from Unified Box isn't available for ${provider(acct?.provider ?? "gmail")?.name ?? "this app"} yet.`);
  if (b.send && !acct.can_send) return bad("This account is read-only. Reconnect it with sending enabled to reply from here.");

  let mode: (typeof MODES)[number] = "reply", to: string[] = [], cc: string[] = [], subject: string, body: string;
  if (isEmailProvider(acct.provider)) {
    mode = b.mode as (typeof MODES)[number];
    if (!MODES.includes(mode)) return bad("invalid mode");
    const list = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]).map((x) => x.trim()).filter(Boolean) : null);
    const toL = list(b.to), ccL = list(b.cc ?? []);
    if (!toL || !ccL) return bad("invalid recipients");
    to = toL; cc = ccL;
    const badAddr = [...to, ...cc].find((x) => !isEmail(x));
    if (badAddr) return bad(`Not a valid email address: ${badAddr.slice(0, 80)}`);
    if (!to.length) return bad("Add at least one recipient");
    if (to.length + cc.length > 50) return bad("Too many recipients (max 50)");
    const v = validateEdits(b.subject, b.body);
    if ("error" in v) return bad(v.error);
    if (!v.edits.subject || !v.edits.body) return bad("Subject and message are required");
    subject = v.edits.subject; body = v.edits.body;
  } else {
    // Chat apps (WhatsApp, Telegram): just a message back into the same chat.
    const v = validateEdits(undefined, b.body);
    if ("error" in v || !v.edits.body) return bad("Write a message first");
    if (v.edits.body.length > 4096) return bad("Message is too long (max 4096 characters)");
    body = v.edits.body; subject = t.subject || "Chat";
  }

  const { data: d, error } = await db.from("drafts").insert({
    user_id: user.id, account_id: t.account_id, thread_id: t.id, mode, to_addrs: to, cc_addrs: cc,
    subject, body, created_by: "user",
  }).select("id").single();
  if (error || !d) return bad("could not save", 500);

  if (!b.send) return NextResponse.json({ status: "pending", draft_id: d.id });
  const r = await decideDraft(user.id, d.id, "approve");
  return NextResponse.json({ ...r.body, draft_id: d.id }, { status: r.status });
}

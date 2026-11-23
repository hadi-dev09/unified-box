import { NextRequest, NextResponse } from "next/server";
import { later } from "@/lib/later";
import { payloadAccountId, payloadValue, saveConnectedAccount, validWebhookKey } from "@/lib/unipile";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncAccount } from "@/lib/sync";

/**
 * Unipile pushes new messages, new emails, read changes and account status here (the URL carries our secret key).
 * We refresh that account right away; "account added" events also finish a connection if the browser didn't come back.
 */
export async function POST(req: NextRequest) {
  if (!validWebhookKey(req.nextUrl.searchParams.get("k"))) return new NextResponse("unauthorized", { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const acc = payloadAccountId(b);
  if (!acc) return NextResponse.json({ ok: true });
  const state = typeof b.state === "string" ? b.state : typeof (b.data as Record<string, unknown> | undefined)?.state === "string" ? String((b.data as Record<string, unknown>).state) : null;
  later(async () => {
    if (state) await saveConnectedAccount(state, acc).catch(() => null);
    const db = supabaseAdmin();
    const event = String(b.event ?? b.type ?? "");
    if (/account\.status\.disconnected/.test(event)) {
      await db.from("accounts").update({ status: "needs_reauth", status_detail: "Disconnected. Click Reconnect to sign in again." }).eq("remote_id", acc);
      return;
    }
    // A new message in one chat: fetch just that chat (fast); anything else: refresh the account.
    const chatId = /^message\./.test(event) ? payloadValue(b, "chat_id") : null;
    const { data } = await db.from("accounts").select("id").eq("remote_id", acc);
    for (const a of (data ?? []) as { id: string }[]) await syncAccount(a.id, chatId ? { chatId } : {}).catch(() => null);
  });
  return NextResponse.json({ ok: true });
}

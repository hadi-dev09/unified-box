import { NextRequest, NextResponse } from "next/server";
import { later } from "@/lib/later";
import { logSyncEvent, payloadAccountId, payloadValue, saveConnectedAccount, storeWebhookMessage, unipileAccountDown, validWebhookKey } from "@/lib/unipile";
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
    const { data: ours } = await db.from("accounts").select("id").eq("remote_id", acc).limit(1);
    await logSyncEvent((ours?.[0]?.id as string | undefined) ?? null, "webhook", event || "unknown");
    if (/account\.status\.(disconnected|errored)/.test(event)) {
      // Unipile reports short drops too; flag only if it's still down when we ask.
      if (await unipileAccountDown(acc)) await db.from("accounts").update({ status: "needs_reauth", status_detail: "Disconnected. Click Reconnect to sign in again." }).eq("remote_id", acc);
      return;
    }
    if (/account\.status\.running|account\.reconnect/.test(event)) {
      await db.from("accounts").update({ status: "connected", status_detail: null }).eq("remote_id", acc);
    }
    // A new message in one chat: fetch just that chat (fast); anything else: refresh the account.
    const chatId = /^message\./.test(event) ? payloadValue(b, "chat_id") : null;
    // TEMP diagnostics: payload shape (field names only).
    const shape = (v: unknown, d: number): unknown => (d > 2 || !v || typeof v !== "object" ? typeof v : Array.isArray(v) ? [shape(v[0], d + 1)] : Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, shape(x, d + 1)])));
    console.log("[unipile-diag] hook", JSON.stringify({ event, chat: chatId?.slice(-6) ?? null, shape: shape(b, 0) }));
    const { data } = await db.from("accounts").select("id, user_id, external_id").eq("remote_id", acc);
    for (const a of (data ?? []) as { id: string; user_id: string; external_id: string }[]) {
      // New message: save it straight from the webhook (instant), then refresh that chat as a backup.
      if (event === "message.new") {
        const ok = await storeWebhookMessage(a, b).catch(async (e) => { await logSyncEvent(a.id, "hook_store_error", String((e as Error).message)); return false; });
        await logSyncEvent(a.id, ok ? "hook_stored" : "hook_no_message", null as unknown as string);
      }
      await syncAccount(a.id, chatId ? { chatId } : {}).catch(() => null);
    }
  });
  return NextResponse.json({ ok: true });
}

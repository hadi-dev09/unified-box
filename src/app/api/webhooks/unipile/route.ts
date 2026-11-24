import { NextRequest, NextResponse } from "next/server";
import { later } from "@/lib/later";
import { applyChatUpdate, applyMessageUpdate, logSyncEvent, payloadAccountId, saveConnectedAccount, storeWebhookMessage, unipileAccountDown, validWebhookKey } from "@/lib/unipile";
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
    // Webhooks carry everything we need, so no extra Unipile requests here (Unipile caps those).
    const { data } = await db.from("accounts").select("id, user_id, external_id").eq("remote_id", acc);
    for (const a of (data ?? []) as { id: string; user_id: string; external_id: string }[]) {
      if (event === "message.new") {
        const ok = await storeWebhookMessage(a, b).catch(async (e) => { await logSyncEvent(a.id, "hook_store_error", String((e as Error).message)); return false; });
        if (!ok) await logSyncEvent(a.id, "hook_no_message", event);
      } else if (event === "chat.update") {
        await applyChatUpdate(a.id, b).catch(() => false);
      } else if (event === "message.update") {
        await applyMessageUpdate(a.id, b).catch(() => false);
      } else if (/account\.(add|reconnect)/.test(event)) {
        await syncAccount(a.id).catch(() => null);
      }
    }
  });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { loadRules } from "@/lib/clients";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { storeConversation } from "@/lib/sync";
import { parseGatewayEvent, validGatewaySignature } from "@/lib/wa-gateway";

// Messages and status changes pushed by the WhatsApp gateway (signed with WA_GATEWAY_WEBHOOK_SECRET, HMAC-SHA512).
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!validGatewaySignature(raw, req.headers.get("x-webhook-hmac"), process.env.WA_GATEWAY_WEBHOOK_SECRET ?? "")) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad json", { status: 400 }); }
  const ev = parseGatewayEvent(body);
  if (ev.kind === "ignore") return NextResponse.json({ ok: true });
  const db = supabaseAdmin();
  const { data: acct } = await db.from("accounts").select("id, user_id, external_id").eq("provider", "whatsapp_web").eq("external_id", ev.session).maybeSingle();
  if (!acct) return NextResponse.json({ ok: true }); // a session we don't (or no longer) know
  if (ev.kind === "status") {
    if (ev.status === "WORKING") await db.from("accounts").update({ status: "connected", status_detail: null }).eq("id", acct.id);
    if (ev.status === "FAILED" || ev.status === "SCAN_QR_CODE" || ev.status === "STOPPED") {
      await db.from("accounts").update({ status: "needs_reauth", status_detail: "WhatsApp was unlinked from the phone. Link it again in Settings." }).eq("id", acct.id);
    }
    return NextResponse.json({ ok: true });
  }
  await storeConversation(acct, ev.chatId, [ev.msg], ev.msg.unread, await loadRules(acct.user_id), ev.chatName);
  await db.from("accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", acct.id);
  return NextResponse.json({ ok: true });
}

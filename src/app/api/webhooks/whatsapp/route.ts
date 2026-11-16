import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { loadRules } from "@/lib/clients";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { storeConversation } from "@/lib/sync";
import { parseWebhook, validSignature } from "@/lib/whatsapp";

// Meta's webhook verification handshake.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const want = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  const got = p.get("hub.verify_token") ?? "";
  const ok = p.get("hub.mode") === "subscribe" && want.length > 0 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  return ok ? new NextResponse(p.get("hub.challenge") ?? "", { status: 200 }) : new NextResponse("forbidden", { status: 403 });
}

// Incoming WhatsApp messages. Signed by Meta with the app secret; anything unsigned is rejected.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET ?? "";
  if (!secret || !validSignature(raw, req.headers.get("x-hub-signature-256"), secret)) return new NextResponse("invalid signature", { status: 401 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad json", { status: 400 }); }
  const db = supabaseAdmin();
  for (const batch of parseWebhook(body)) {
    const { data: accts } = await db.from("accounts").select("id, user_id, external_id").eq("provider", "whatsapp").eq("external_id", batch.phoneNumberId);
    for (const acct of accts ?? []) {
      await storeConversation(acct, batch.waId, batch.msgs, true, await loadRules(acct.user_id), batch.name);
      await db.from("accounts").update({ last_synced_at: new Date().toISOString(), status: "connected", status_detail: null }).eq("id", acct.id);
    }
  }
  return NextResponse.json({ ok: true }); // always 200 for valid events so Meta doesn't retry
}

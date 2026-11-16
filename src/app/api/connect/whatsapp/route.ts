import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { waNumberInfo, waSubscribe, whatsappConfigured } from "@/lib/whatsapp";

// Connect a WhatsApp Business number (Cloud API): phone number ID + permanent access token (+ optional WABA ID).
export async function POST(req: NextRequest) {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!whatsappConfigured()) return NextResponse.json({ error: "WhatsApp isn't available yet." }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const phoneNumberId = String(b.phone_number_id ?? "").trim(), wabaId = String(b.waba_id ?? "").trim(), token = String(b.token ?? "").trim();
  if (!/^\d{6,25}$/.test(phoneNumberId)) return NextResponse.json({ error: "Enter the Phone number ID (digits) from WhatsApp Manager → API Setup." }, { status: 400 });
  if (wabaId && !/^\d{6,25}$/.test(wabaId)) return NextResponse.json({ error: "The WhatsApp Business Account ID should be digits." }, { status: 400 });
  if (token.length < 20 || /\s/.test(token)) return NextResponse.json({ error: "Paste the full access token (no spaces)." }, { status: 400 });
  try {
    const info = await waNumberInfo(phoneNumberId, token);
    if (wabaId) await waSubscribe(wabaId, token);
    const db = supabaseAdmin();
    const { data: acct, error } = await db.from("accounts").upsert(
      { user_id: user.id, provider: "whatsapp", account_type: "company", display_name: `${info.name}${info.display ? ` · ${info.display}` : ""}`, external_id: phoneNumberId,
        status: "connected", status_detail: null, can_send: true, meta: { display_phone_number: info.display, waba_id: wabaId || null } },
      { onConflict: "user_id,provider,external_id" },
    ).select("id").single();
    if (error || !acct) throw new Error(error?.message ?? "account upsert failed");
    await db.from("account_secrets").upsert({ account_id: acct.id, tokens_enc: encrypt(JSON.stringify({ access_token: token })) });
    await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "account.connected", target: info.display || phoneNumberId, meta: { provider: "whatsapp" } });
    return NextResponse.json({ ok: true, name: info.name, number: info.display });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

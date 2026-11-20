import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { gwCreateSession, gwLogout, gwPairingCode, gwQr, gwStatus, validSessionName, waGatewayConfigured } from "@/lib/wa-gateway";

/**
 * Link WhatsApp by QR code (or pairing code), through the self-hosted gateway.
 *   POST {action:"start"}                -> creates a gateway session for this user
 *   GET                                   -> { status, qr? } while linking; { status:"WORKING", connected } once linked
 *   POST {action:"code", phone}           -> 8-character code to type on the phone instead of scanning
 *   POST {action:"cancel"}                -> drops the half-finished link
 * The pending session lives in an encrypted http-only cookie bound to the user.
 */
const COOKIE = "wa_link";
type Pending = { uid: string; session: string; at: number };
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function pending(req: NextRequest, uid: string): Promise<Pending | null> {
  try {
    const p = JSON.parse(decrypt(req.cookies.get(COOKIE)?.value ?? "")) as Pending;
    return p.uid === uid && validSessionName(p.session) && Date.now() - p.at < 15 * 60_000 ? p : null;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return fail("unauthorized", 401);
  if (!waGatewayConfigured()) return fail("WhatsApp QR linking isn't set up on this server yet.");
  const b = (await req.json().catch(() => ({}))) as { action?: string; phone?: string };
  const p = await pending(req, user.id);

  if (b.action === "start") {
    if (p) await gwLogout(p.session);
    const session = `ub${randomBytes(10).toString("hex")}`;
    try {
      await gwCreateSession(session, `${env("APP_URL")}/api/webhooks/wa-gateway`);
    } catch (e) { return fail(`Couldn't reach the WhatsApp gateway. ${(e as Error).message.slice(0, 120)}`, 502); }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE, encrypt(JSON.stringify({ uid: user.id, session, at: Date.now() })), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: 900, path: "/api/connect/whatsapp-web" });
    return res;
  }
  if (!p) return fail("The link expired. Start again.");
  if (b.action === "code") {
    const phone = String(b.phone ?? "").replace(/[^\d+]/g, "");
    if (!/^\+?\d{8,15}$/.test(phone)) return fail("Enter your WhatsApp number in international format, e.g. +92 300 1234567.");
    try { return NextResponse.json({ code: await gwPairingCode(p.session, phone) }); }
    catch { return fail("Couldn't get a code. Wait for the QR code to appear, then try again."); }
  }
  if (b.action === "cancel") {
    await gwLogout(p.session);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete({ name: COOKIE, path: "/api/connect/whatsapp-web" });
    return res;
  }
  return fail("bad action");
}

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return fail("unauthorized", 401);
  const p = await pending(req, user.id);
  if (!p) return fail("The link expired. Start again.", 410);
  let st: Awaited<ReturnType<typeof gwStatus>>;
  try { st = await gwStatus(p.session); } catch { return fail("Couldn't reach the WhatsApp gateway.", 502); }

  if (st.status === "SCAN_QR_CODE") return NextResponse.json({ status: st.status, qr: await gwQr(p.session).catch(() => null) });
  if (st.status === "PASSKEY_REQUIRED" || st.status === "PASSKEY_CONFIRMATION_REQUIRED") {
    return NextResponse.json({ status: st.status, message: "WhatsApp is asking this phone for a passkey before it allows new linked devices. This can't be completed from Unified Box yet. Try again later or use WhatsApp Business (official) instead." });
  }
  if (st.status !== "WORKING") return NextResponse.json({ status: st.status });

  const wid = String(st.me?.id ?? "");
  const phone = `+${wid.split("@")[0].split(":")[0]}`;
  const name = st.me?.pushName ? `${st.me.pushName} · ${phone}` : phone;
  const db = supabaseAdmin();
  const { data: acct, error } = await db.from("accounts").upsert(
    { user_id: user.id, provider: "whatsapp_web", account_type: "personal", display_name: name, external_id: p.session, status: "connected", status_detail: null, can_send: true, meta: { wid } },
    { onConflict: "user_id,provider,external_id" },
  ).select("id").single();
  if (error || !acct) return fail("Linked, but couldn't save the account.", 500);
  await db.from("account_secrets").upsert({ account_id: acct.id, tokens_enc: encrypt(JSON.stringify({ session: p.session })) });
  await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "account.connected", target: phone, meta: { provider: "whatsapp_web" } });
  const res = NextResponse.json({ status: "WORKING", connected: name });
  res.cookies.delete({ name: COOKIE, path: "/api/connect/whatsapp-web" });
  return res;
}

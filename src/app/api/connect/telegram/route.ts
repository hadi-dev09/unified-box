import { NextRequest, NextResponse } from "next/server";
import { decrypt, encrypt } from "@/lib/crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { syncAccount } from "@/lib/sync";
import { encryptSession, normalizePhone, telegramClient, telegramConfigured } from "@/lib/telegram";

// Telegram sign-in in up to three steps: { action: "start", phone } -> { action: "code", code } -> { action: "password", password }.
// The half-finished login lives in an encrypted, http-only cookie for 10 minutes.
const COOKIE = "tg_login";
type Pending = { uid: string; phone: string; hash: string; session: string };
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const friendly = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/PHONE_NUMBER_INVALID/.test(m)) return "That phone number isn't registered on Telegram.";
  if (/PHONE_CODE_INVALID|PHONE_CODE_EMPTY/.test(m)) return "That code is incorrect. Check the code Telegram sent you.";
  if (/PHONE_CODE_EXPIRED/.test(m)) return "That code has expired. Start again to get a new one.";
  if (/PASSWORD_HASH_INVALID/.test(m)) return "Wrong two-step verification password.";
  if (/FLOOD_WAIT/.test(m)) return "Telegram asked us to wait before trying again. Please try in a few minutes.";
  return "Telegram sign-in failed. Please try again.";
};

export async function POST(req: NextRequest) {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return fail("unauthorized", 401);
  if (!telegramConfigured()) return fail("Telegram isn't available yet.");
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  const setPending = (res: NextResponse, p: Pending) => {
    res.cookies.set(COOKIE, encrypt(JSON.stringify(p)), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", maxAge: 600, path: "/api/connect/telegram" });
    return res;
  };
  let pending: Pending | null = null;
  try { const c = req.cookies.get(COOKIE)?.value; pending = c ? (JSON.parse(decrypt(c)) as Pending) : null; } catch { pending = null; }
  if (pending && pending.uid !== user.id) pending = null;

  if (b.action === "start") {
    const phone = normalizePhone(String(b.phone ?? ""));
    if (!phone) return fail("Enter your phone number in international format, e.g. +92 300 1234567.");
    // At most 5 code requests per user per 30 minutes (stops the form being used to spam codes).
    const db = supabaseAdmin();
    const { count } = await db.from("audit_log").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("action", "telegram.code_requested").gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString());
    if ((count ?? 0) >= 5) return fail("Too many attempts. Please wait 30 minutes and try again.", 429);
    await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "telegram.code_requested", target: `…${phone.slice(-4)}` });
    const client = await telegramClient("");
    try {
      await client.connect();
      const { phoneCodeHash } = await client.sendCode(phone);
      return setPending(NextResponse.json({ step: "code" }), { uid: user.id, phone, hash: phoneCodeHash, session: client.saveSession() });
    } catch (e) { return fail(friendly(e)); } finally { await client.disconnect().catch(() => {}); }
  }

  if (!pending) return fail("Your sign-in expired. Start again.");
  const client = await telegramClient(pending.session);
  try {
    await client.connect();
    if (b.action === "code") {
      const code = String(b.code ?? "").replace(/\s+/g, "");
      if (!/^\d{4,8}$/.test(code)) return fail("Enter the code Telegram sent you.");
      const r = await client.signIn(pending.phone, pending.hash, code);
      if (r === "password") return setPending(NextResponse.json({ step: "password" }), { ...pending, session: client.saveSession() });
    } else if (b.action === "password") {
      if (!b.password) return fail("Enter your two-step verification password.");
      await client.checkPassword(String(b.password));
    } else return fail("bad action");

    const me = await client.me();
    const db = supabaseAdmin();
    const { data: acct, error } = await db.from("accounts").upsert(
      { user_id: user.id, provider: "telegram", account_type: "personal", display_name: me.username ? `@${me.username}` : me.name || pending.phone, external_id: me.id,
        status: "connected", status_detail: null, can_send: true, meta: { phone_last4: pending.phone.slice(-4) } },
      { onConflict: "user_id,provider,external_id" },
    ).select("id").single();
    if (error || !acct) throw new Error(error?.message ?? "account upsert failed");
    await db.from("account_secrets").upsert({ account_id: acct.id, tokens_enc: encryptSession(client.saveSession()) });
    await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "account.connected", target: me.username ?? me.id, meta: { provider: "telegram" } });
    await client.disconnect().catch(() => {});
    await syncAccount(acct.id);
    const res = NextResponse.json({ step: "done", name: me.username ? `@${me.username}` : me.name });
    res.cookies.delete({ name: COOKIE, path: "/api/connect/telegram" });
    return res;
  } catch (e) {
    return fail(friendly(e));
  } finally { await client.disconnect().catch(() => {}); }
}

import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { OUTLOOK_SEND_SCOPE, outlookExchange, outlookMe } from "@/lib/outlook";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { syncAccount } from "@/lib/sync";

const back = (msg: string) => NextResponse.redirect(`${env("APP_URL")}/settings?msg=${encodeURIComponent(msg)}`);

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const raw = req.cookies.get("ms_oauth")?.value;
  if (!raw) return back("Connection expired. Please try again.");
  let saved: { nonce: string; uid: string; type: "personal" | "company"; write: boolean };
  try { saved = JSON.parse(raw); } catch { return back("Invalid connection request."); }
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user || user.id !== saved.uid || p.get("state") !== saved.nonce) return back("Invalid connection request.");
  if (p.get("error")) {
    const d = p.get("error_description") ?? "";
    return back(/AADSTS65001|admin|consent/i.test(d) || p.get("error") === "access_denied"
      ? "Microsoft didn't grant access. For a work account, your IT admin may need to approve Unified Box."
      : `Microsoft error: ${p.get("error")}`);
  }
  try {
    const t = await outlookExchange(p.get("code") ?? "");
    const me = await outlookMe(t.access_token);
    if (!me.email) throw new Error("Couldn't read your email address from Microsoft.");
    const db = supabaseAdmin();
    const canSend = t.scope.split(" ").some((s) => s.toLowerCase().endsWith(OUTLOOK_SEND_SCOPE.toLowerCase()));
    const { data: acct, error } = await db.from("accounts").upsert(
      { user_id: user.id, provider: "outlook", account_type: saved.type, display_name: me.email, external_id: me.email, status: "connected", status_detail: null, can_send: canSend },
      { onConflict: "user_id,provider,external_id" },
    ).select("id").single();
    if (error || !acct) throw new Error(error?.message ?? "account upsert failed");
    await db.from("account_secrets").upsert({ account_id: acct.id, tokens_enc: encrypt(JSON.stringify(t)) });
    await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "account.connected", target: me.email, meta: { provider: "outlook", can_send: canSend } });
    await syncAccount(acct.id);
    const res = back(`Connected ${me.email}`);
    res.cookies.delete({ name: "ms_oauth", path: "/api/connect/outlook" });
    return res;
  } catch (e) {
    return back(`Could not connect Outlook: ${(e as Error).message}`);
  }
}

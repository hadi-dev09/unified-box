import { NextRequest, NextResponse } from "next/server";
import { emailFromIdToken, exchangeCode, SEND_SCOPE } from "@/lib/gmail";
import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { syncAccount } from "@/lib/sync";

const back = (msg: string) => NextResponse.redirect(`${env("APP_URL")}/settings?msg=${encodeURIComponent(msg)}`);

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const raw = req.cookies.get("gmail_oauth")?.value;
  if (!raw) return back("Connection expired. Please try again.");
  const saved = JSON.parse(raw) as { nonce: string; uid: string; type: "personal" | "company"; write: boolean };

  // CSRF + session binding
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user || user.id !== saved.uid || p.get("state") !== saved.nonce) return back("Invalid connection request.");

  if (p.get("error")) {
    // Company Workspaces can block third-party apps; surface that plainly instead of failing silently.
    const e = p.get("error")!;
    return back(e === "access_denied"
      ? "Google refused the connection. For a company account, a Workspace admin may be blocking third-party apps."
      : `Google error: ${e}`);
  }

  try {
    const t = await exchangeCode(p.get("code")!);
    const email = emailFromIdToken(t.id_token);
    const db = supabaseAdmin();
    const { data: acct, error } = await db
      .from("accounts")
      .upsert(
        {
          user_id: user.id, provider: "gmail", account_type: saved.type, display_name: email, external_id: email,
          status: "connected", status_detail: null, can_send: t.scope.includes(SEND_SCOPE),
        },
        { onConflict: "user_id,provider,external_id" },
      )
      .select("id")
      .single();
    if (error || !acct) throw new Error(error?.message ?? "account upsert failed");

    await db.from("account_secrets").upsert({
      account_id: acct.id,
      tokens_enc: encrypt(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, scope: t.scope })),
    });
    await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "account.connected", target: email, meta: { type: saved.type, can_send: t.scope.includes(SEND_SCOPE) } });

    await syncAccount(acct.id);
    const res = back(`Connected ${email}`);
    res.cookies.delete({ name: "gmail_oauth", path: "/api/connect/gmail" });
    return res;
  } catch (e) {
    return back(`Could not connect: ${(e as Error).message}`);
  }
}

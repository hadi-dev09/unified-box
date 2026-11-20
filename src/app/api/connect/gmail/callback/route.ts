import { NextRequest, NextResponse } from "next/server";
import { emailFromIdToken, exchangeCode, idTokenClaims, READ_SCOPE, SEND_SCOPE } from "@/lib/gmail";
import { safeNext } from "@/lib/safe-next";
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
  let saved: { nonce: string; uid?: string; type?: "personal" | "company"; write?: boolean; mode?: "signin"; next?: string };
  try { saved = JSON.parse(raw); } catch { return back("Invalid connection request."); }
  const sb = await supabaseServer();

  // ---- "Continue with Google": sign in / sign up, then connect this Gmail ----
  if (saved.mode === "signin") {
    const toLogin = (m: string) => NextResponse.redirect(`${env("APP_URL")}/login?error=${encodeURIComponent(m)}`);
    if (p.get("state") !== saved.nonce) return toLogin("Sign-in expired. Please try again.");
    if (p.get("error")) return toLogin(p.get("error") === "access_denied" ? "Google sign-in was cancelled." : `Google error: ${p.get("error")}`);
    try {
      const t = await exchangeCode(p.get("code") ?? "", false);
      const who = idTokenClaims(t.id_token);
      if (!who.emailVerified) return toLogin("Your Google email isn't verified.");
      const admin = supabaseAdmin();
      await admin.auth.admin.createUser({ email: who.email, email_confirm: true, user_metadata: { full_name: who.name, ...(who.picture ? { avatar_url: who.picture } : {}) } }).catch(() => null); // exists already: fine
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: who.email });
      if (linkErr || !link?.properties?.hashed_token) throw new Error(linkErr?.message ?? "could not start session");
      const { data: session, error: vErr } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
      const uid = session?.user?.id;
      if (vErr || !uid) throw new Error(vErr?.message ?? "could not start session");
      // Fill in name/photo from Google only where the profile has none yet.
      const meta = (session?.user?.user_metadata ?? {}) as { full_name?: string; avatar_url?: string };
      const fill = { ...(!meta.full_name && who.name ? { full_name: who.name } : {}), ...(!meta.avatar_url && who.picture ? { avatar_url: who.picture } : {}) };
      if (Object.keys(fill).length) { await sb.auth.updateUser({ data: fill }).catch(() => null); await sb.auth.refreshSession().catch(() => null); }
      const withMail = (t.scope ?? "").includes(READ_SCOPE) && Boolean(t.refresh_token);
      if (withMail) {
        const { data: acct, error } = await admin.from("accounts").upsert(
          { user_id: uid, provider: "gmail", account_type: "personal", display_name: who.email, external_id: who.email, status: "connected", status_detail: null, can_send: t.scope.includes(SEND_SCOPE) },
          { onConflict: "user_id,provider,external_id" },
        ).select("id").single();
        if (error || !acct) throw new Error(error?.message ?? "account upsert failed");
        await admin.from("account_secrets").upsert({ account_id: acct.id, tokens_enc: encrypt(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, scope: t.scope })) });
        await syncAccount(acct.id).catch(() => null);
      }
      await admin.from("audit_log").insert({ user_id: uid, actor: "user", action: "auth.google", target: who.email, meta: { gmail_connected: withMail } });
      // New here with nothing connected yet: go straight to adding a channel.
      const { count } = await admin.from("accounts").select("id", { count: "exact", head: true }).eq("user_id", uid);
      const res = NextResponse.redirect(`${env("APP_URL")}${count ? safeNext(saved.next) : "/settings"}`);
      res.cookies.delete({ name: "gmail_oauth", path: "/api/connect/gmail" });
      return res;
    } catch (e) {
      return toLogin(`Google sign-in failed: ${(e as Error).message}`.slice(0, 200));
    }
  }

  // CSRF + session binding
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
          user_id: user.id, provider: "gmail", account_type: saved.type ?? "personal", display_name: email, external_id: email,
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

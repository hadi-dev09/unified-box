import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";

// OAuth (Google/Slack) and PKCE email links land here.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const base = env("APP_URL");
  const err = p.get("error_description") ?? p.get("error");
  if (err) return NextResponse.redirect(`${base}/login?error=${encodeURIComponent(/expired/i.test(err) ? "That link has expired. Request a new one." : "Sign-in was cancelled or failed. Please try again.")}`);
  const code = p.get("code");
  if (code) {
    const { error } = await (await supabaseServer()).auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(`${base}/login?error=${encodeURIComponent("This link must be opened in the same browser you requested it from, or it has expired. Sign in with your password or a code instead.")}`);
  }
  return NextResponse.redirect(`${base}${safeNext(p.get("next"))}`);
}

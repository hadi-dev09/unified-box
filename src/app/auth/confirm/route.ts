import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";

// Email links using {{ .TokenHash }} land here. Unlike the PKCE code flow, this works even if the link is
// opened on a different device or browser than the one that requested it.
const TYPES: EmailOtpType[] = ["signup", "email", "recovery", "invite", "email_change", "magiclink"];

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token_hash = p.get("token_hash"), type = p.get("type") as EmailOtpType | null;
  const base = env("APP_URL");
  if (!token_hash || !type || !TYPES.includes(type)) return NextResponse.redirect(`${base}/login?error=${encodeURIComponent("That link is invalid.")}`);
  const { error } = await (await supabaseServer()).auth.verifyOtp({ token_hash, type });
  if (error) return NextResponse.redirect(`${base}/login?error=${encodeURIComponent("That link is invalid or has expired. Request a new one.")}`);
  return NextResponse.redirect(`${base}${type === "recovery" ? "/reset-password" : safeNext(p.get("next"))}`);
}

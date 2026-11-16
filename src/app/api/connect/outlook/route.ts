import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { outlookAuthUrl, outlookConfigured } from "@/lib/outlook";
import { supabaseServer } from "@/lib/supabase/server";

// Start Microsoft sign-in. ?type=personal|company  &write=1 to also allow sending.
export async function GET(req: NextRequest) {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.redirect(`${env("APP_URL")}/login`);
  if (!outlookConfigured()) return NextResponse.redirect(`${env("APP_URL")}/settings?msg=${encodeURIComponent("Outlook isn't available yet.")}`);
  const type = req.nextUrl.searchParams.get("type") === "company" ? "company" : "personal";
  const write = req.nextUrl.searchParams.get("write") === "1";
  const nonce = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(outlookAuthUrl(nonce, write));
  res.cookies.set("ms_oauth", JSON.stringify({ nonce, uid: user.id, type, write }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/connect/outlook",
  });
  return res;
}

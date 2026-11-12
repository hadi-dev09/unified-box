import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { slackAuthUrl, slackConfigured } from "@/lib/slack";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET() {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.redirect(`${env("APP_URL")}/login`);
  if (!slackConfigured()) return NextResponse.redirect(`${env("APP_URL")}/settings?msg=${encodeURIComponent("Slack isn't configured yet. See CHECKLIST.md to create the Slack app.")}`);
  const nonce = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(slackAuthUrl(nonce));
  res.cookies.set("slack_oauth", JSON.stringify({ nonce, uid: user.id }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/connect/slack",
  });
  return res;
}

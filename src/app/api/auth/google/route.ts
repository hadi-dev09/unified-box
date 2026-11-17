import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { authUrl } from "@/lib/gmail";
import { safeNext } from "@/lib/safe-next";

/**
 * "Continue with Google": one Google screen that signs you in (creating the account if new) AND connects that Gmail
 * inbox. Uses the same Google app and callback as connecting Gmail.
 */
export async function GET(req: NextRequest) {
  if (!process.env.GOOGLE_CLIENT_ID) return NextResponse.redirect(`${env("APP_URL")}/login?error=${encodeURIComponent("Google sign-in isn't available right now.")}`);
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const nonce = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(authUrl(nonce, true));
  res.cookies.set("gmail_oauth", JSON.stringify({ nonce, mode: "signin", next }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/connect/gmail",
  });
  return res;
}

import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authUrl } from "@/lib/gmail";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";

// Start Gmail OAuth. ?type=personal|company  &write=1 to also request the send scope.
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(`${env("APP_URL")}/login`);

  const type = req.nextUrl.searchParams.get("type") === "company" ? "company" : "personal";
  const write = req.nextUrl.searchParams.get("write") === "1";
  const nonce = randomBytes(24).toString("hex");

  const res = NextResponse.redirect(authUrl(nonce, write));
  res.cookies.set("gmail_oauth", JSON.stringify({ nonce, uid: user.id, type, write }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/connect/gmail",
  });
  return res;
}

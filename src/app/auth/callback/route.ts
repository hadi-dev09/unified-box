import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) await (await supabaseServer()).auth.exchangeCodeForSession(code);
  return NextResponse.redirect(`${env("APP_URL")}/`);
}

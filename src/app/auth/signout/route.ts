import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST() {
  await (await supabaseServer()).auth.signOut();
  return NextResponse.redirect(`${env("APP_URL")}/`, { status: 303 });
}

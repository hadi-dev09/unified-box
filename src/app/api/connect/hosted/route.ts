import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { hostedConnectLink, UNIPILE_PROVIDER, unipileConfigured } from "@/lib/unipile";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** "Connect Gmail / WhatsApp / …": sends you to the sign-in page (Google, Microsoft, WhatsApp QR code, …), then back to Settings. */
export async function GET(req: NextRequest) {
  const back = (m: string) => NextResponse.redirect(`${env("APP_URL")}/settings?msg=${encodeURIComponent(m)}`);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${env("APP_URL")}/login?next=/settings`);
  const p = req.nextUrl.searchParams.get("p") ?? "";
  if (!unipileConfigured() || !UNIPILE_PROVIDER[p]) return back("That channel can't be connected right now.");
  // Reconnect keeps the same account (e.g. WhatsApp after the phone was unlinked).
  const reconnect = req.nextUrl.searchParams.get("account");
  let remote: string | undefined;
  if (reconnect) {
    const { data } = await supabaseAdmin().from("accounts").select("remote_id").eq("id", reconnect).eq("user_id", user.id).maybeSingle();
    remote = (data?.remote_id as string | undefined) ?? undefined;
  }
  try {
    return NextResponse.redirect(await hostedConnectLink(user.id, p, remote));
  } catch (e) {
    return back(`Couldn't start the connection: ${(e as Error).message}`.slice(0, 200));
  }
}

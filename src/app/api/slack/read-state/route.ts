import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { quickSlackReadCheck } from "@/lib/slack";
import { quickUnipileCheck } from "@/lib/unipile";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Called every few seconds while the app is open: picks up "read in Slack", and new WhatsApp/Telegram/Instagram/
 * Messenger/LinkedIn messages and phone read state, within seconds.
 */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabaseAdmin().from("accounts").select("id, provider, remote_id").eq("user_id", user.id).eq("status", "connected");
  const rows = (data ?? []) as { id: string; provider: string; remote_id: string | null }[];
  const jobs = [
    ...rows.filter((a) => a.provider === "slack").map((a) => quickSlackReadCheck(a.id).catch(() => 0)),
    ...rows.filter((a) => a.remote_id).map((a) => quickUnipileCheck(a.id).catch(() => 0)),
  ];
  const changed = (await Promise.all(jobs)).reduce((x, y) => x + y, 0);
  return NextResponse.json({ changed });
}

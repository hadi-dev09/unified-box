import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { quickSlackReadCheck } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Called every few seconds while the app is open: picks up "read in Slack" right away for your Slack accounts. */
export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabaseAdmin().from("accounts").select("id").eq("user_id", user.id).eq("provider", "slack").eq("status", "connected");
  const changed = (await Promise.all(((data ?? []) as { id: string }[]).map((a) => quickSlackReadCheck(a.id).catch(() => 0)))).reduce((x, y) => x + y, 0);
  return NextResponse.json({ changed });
}

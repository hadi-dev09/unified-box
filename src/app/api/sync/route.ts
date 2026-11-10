import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { syncAccount } from "@/lib/sync";

export const maxDuration = 60;

function safeEq(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// POST with a signed-in session syncs your accounts; POST with Bearer CRON_SECRET syncs everyone's (for a scheduler).
export async function POST(req: NextRequest) {
  const db = supabaseAdmin();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const cron = process.env.CRON_SECRET;

  let q = db.from("accounts").select("id").eq("provider", "gmail").in("status", ["connected", "error"]);
  if (!(cron && bearer && safeEq(bearer, cron))) {
    const { data: { user } } = await (await supabaseServer()).auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    q = q.eq("user_id", user.id);
  }
  const { data } = await q;
  const results = [];
  for (const a of data ?? []) results.push(await syncAccount(a.id));
  return NextResponse.json({ results });
}

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cleanupExpired } from "@/lib/accounts";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { syncAccount } from "@/lib/sync";

export const maxDuration = 60;

function isCron(req: NextRequest) {
  const cron = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!cron || !bearer) return false;
  const x = Buffer.from(bearer), y = Buffer.from(cron);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function run(userId: string | null) {
  let q = supabaseAdmin().from("accounts").select("id").in("status", ["connected", "error"]);
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  const results = [];
  for (const a of data ?? []) results.push(await syncAccount(a.id));
  return NextResponse.json({ results });
}

// POST: a signed-in user syncs their own accounts; Bearer CRON_SECRET syncs everyone's.
export async function POST(req: NextRequest) {
  if (isCron(req)) return run(null);
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return run(user.id);
}

// GET: Vercel Cron (sends Authorization: Bearer $CRON_SECRET). Never callable with just a browser session.
export async function GET(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await cleanupExpired();
  return run(null);
}

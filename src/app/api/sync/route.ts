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

const MIN_GAP_MS = 45_000;

/** Syncs accounts; for signed-in users, skips inboxes synced in the last 45s (the app polls every minute). */
async function run(userId: string | null) {
  let q = supabaseAdmin().from("accounts").select("id, last_synced_at").in("status", ["connected", "error"]);
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  const due = (data ?? []).filter((a: { last_synced_at: string | null }) => !userId || !a.last_synced_at || Date.now() - new Date(a.last_synced_at).getTime() > MIN_GAP_MS);
  const results = await Promise.all(due.map((a: { id: string }) => syncAccount(a.id)));
  return NextResponse.json({ results, skipped: (data ?? []).length - due.length, changed: results.some((r) => r.changed || r.error) });
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

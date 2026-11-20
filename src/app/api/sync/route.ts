import { timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { cleanupExpired } from "@/lib/accounts";
import { currentUser } from "@/lib/auth";
import { dueAfterMs } from "@/lib/cron";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncAccount } from "@/lib/sync";

export const maxDuration = 60;

function isCron(req: NextRequest) {
  const cron = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!cron || !bearer) return false;
  const x = Buffer.from(bearer), y = Buffer.from(cron);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Acct = { id: string; provider: string; last_synced_at: string | null; status: string };
const isDue = (a: Acct) => a.provider !== "whatsapp" && a.provider !== "whatsapp_web" && ["connected", "error"].includes(a.status) && (!a.last_synced_at || Date.now() - new Date(a.last_synced_at).getTime() > dueAfterMs(a.provider));

/** A tiny fingerprint of the inbox: the app reloads the screen only when it changes. */
async function fingerprint(userId: string, accts: Acct[]) {
  const db = supabaseAdmin();
  const [{ data: newest }, { count: unread }, { count: drafts }] = await Promise.all([
    db.from("threads").select("last_message_at").eq("user_id", userId).order("last_message_at", { ascending: false }).limit(1),
    db.from("threads").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("unread", true),
    db.from("drafts").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("status", "pending"),
  ]);
  const lastSynced = accts.map((a) => a.last_synced_at).filter(Boolean).sort().pop() ?? null;
  return { version: `${newest?.[0]?.last_message_at ?? ""}|${unread ?? 0}|${drafts ?? 0}|${accts.map((a) => a.status).join(",")}`, lastSynced };
}

/**
 * Signed-in app: returns the inbox fingerprint at once and starts syncing any inbox that is due in the background
 * (the server also syncs every minute on its own, so this only fills gaps).
 */
export async function POST(req: NextRequest) {
  if (isCron(req)) {
    const { data } = await supabaseAdmin().from("accounts").select("id, provider, last_synced_at, status");
    const results = await Promise.all(((data ?? []) as Acct[]).filter(isDue).map((a) => syncAccount(a.id)));
    return NextResponse.json({ results });
  }
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabaseAdmin().from("accounts").select("id, provider, last_synced_at, status").eq("user_id", user.id);
  const accts = (data ?? []) as Acct[];
  const due = accts.filter(isDue);
  const wait = new URL(req.url).searchParams.get("wait") === "1";
  if (due.length && wait) await Promise.all(due.map((a) => syncAccount(a.id).catch(() => null)));
  else if (due.length) after(async () => { await Promise.all(due.map((a) => syncAccount(a.id).catch(() => null))); });
  const after2 = wait && due.length ? ((await supabaseAdmin().from("accounts").select("id, provider, last_synced_at, status").eq("user_id", user.id)).data ?? []) as Acct[] : accts;
  return NextResponse.json({ ...(await fingerprint(user.id, after2)), syncing: due.length > 0 && !wait });
}

// GET: legacy Vercel Cron (Authorization: Bearer $CRON_SECRET). Never callable with just a browser session.
export async function GET(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await cleanupExpired();
  return POST(req);
}

import { after, NextRequest, NextResponse } from "next/server";
import { backgroundSync, validCronKey } from "@/lib/cron";

export const maxDuration = 60;

// Called every minute by Supabase pg_cron. Answers immediately and keeps syncing after the response.
export async function POST(req: NextRequest) {
  if (!(await validCronKey(req.headers.get("x-cron-key")))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  after(async () => { await backgroundSync(); });
  return NextResponse.json({ ok: true });
}

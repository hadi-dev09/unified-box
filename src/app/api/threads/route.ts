import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { applyThreadAction, type ThreadAction } from "@/lib/thread-actions";

// Bulk/single conversation actions from the inbox: read, unread, star, snooze, trash (and their undo).
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { ids?: unknown; action?: unknown; until?: unknown };
  if (!Array.isArray(b.ids)) return NextResponse.json({ error: "ids required" }, { status: 400 });
  const r = await applyThreadAction(user.id, b.ids as string[], String(b.action) as ThreadAction, { until: typeof b.until === "string" ? b.until : undefined });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

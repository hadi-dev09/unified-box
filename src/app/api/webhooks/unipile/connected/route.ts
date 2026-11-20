import { NextRequest, NextResponse } from "next/server";
import { later } from "@/lib/later";
import { saveConnectedAccount } from "@/lib/unipile";
import { syncAccount } from "@/lib/sync";

/**
 * Unipile calls this when someone finishes connecting an account on its sign-in page. The "name" we gave the link
 * is signed with our key and says which user and channel it belongs to, so a forged call can't attach accounts.
 */
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { status?: string; account_id?: string; name?: string };
  if (!b.account_id || !b.name || !/SUCCESS|RECONNECTED/i.test(b.status ?? "")) return NextResponse.json({ ok: true });
  try {
    const saved = await saveConnectedAccount(b.name, b.account_id);
    if (!saved) return NextResponse.json({ error: "unknown connection" }, { status: 400 });
    later(async () => { await syncAccount(saved.accountId).catch(() => null); });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

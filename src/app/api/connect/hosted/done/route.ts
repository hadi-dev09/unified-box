import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { later } from "@/lib/later";
import { saveConnectedAccount } from "@/lib/unipile";
import { syncAccount } from "@/lib/sync";

/** Unipile's sign-in page sends people back here with the new account id and our signed state. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const back = (m: string) => NextResponse.redirect(`${env("APP_URL")}/settings?msg=${encodeURIComponent(m)}`);
  if (q.get("error_title")) return back(`The connection didn't finish: ${q.get("error_title")}`.slice(0, 200));
  const accountId = q.get("account_id"), state = q.get("state");
  if (!accountId || !state) return back("The connection didn't finish. Please try again.");
  try {
    const saved = await saveConnectedAccount(state, accountId);
    if (!saved) return back("That connection couldn't be verified. Please try again.");
    later(async () => { await syncAccount(saved.accountId).catch(() => null); });
    return NextResponse.redirect(`${env("APP_URL")}/settings?connecting=${saved.provider}`);
  } catch (e) {
    return back(`Couldn't finish connecting: ${(e as Error).message}`.slice(0, 200));
  }
}

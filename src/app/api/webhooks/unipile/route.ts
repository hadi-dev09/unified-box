import { NextRequest, NextResponse } from "next/server";
import { later } from "@/lib/later";
import { validWebhookKey } from "@/lib/unipile";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncAccount } from "@/lib/sync";

/** Unipile pushes new messages, new emails and "read on your phone" here; we refresh that account right away. */
export async function POST(req: NextRequest) {
  if (!validWebhookKey(req.headers.get("x-ub-key"))) return new NextResponse("unauthorized", { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { account_id?: string };
  if (!b.account_id) return NextResponse.json({ ok: true });
  later(async () => {
    const { data } = await supabaseAdmin().from("accounts").select("id").eq("remote_id", b.account_id);
    for (const a of (data ?? []) as { id: string }[]) await syncAccount(a.id).catch(() => null);
  });
  return NextResponse.json({ ok: true });
}

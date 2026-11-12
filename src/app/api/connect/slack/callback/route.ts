import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { slackExchange } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { syncAccount } from "@/lib/sync";

const back = (msg: string) => NextResponse.redirect(`${env("APP_URL")}/settings?msg=${encodeURIComponent(msg)}`);

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const raw = req.cookies.get("slack_oauth")?.value;
  if (!raw) return back("Connection expired. Please try again.");
  const saved = JSON.parse(raw) as { nonce: string; uid: string };

  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user || user.id !== saved.uid || p.get("state") !== saved.nonce) return back("Invalid connection request.");

  if (p.get("error")) {
    return back(p.get("error") === "access_denied"
      ? "Slack didn't grant access. In a client's workspace an admin may need to approve the app first: use Slack's \"request approval\" prompt, then try again."
      : `Slack error: ${p.get("error")}`);
  }

  try {
    const s = await slackExchange(p.get("code")!);
    const db = supabaseAdmin();
    const { data: acct, error } = await db.from("accounts").upsert(
      {
        user_id: user.id, provider: "slack", account_type: "company", display_name: s.teamName,
        external_id: `${s.teamId}:${s.userId}`, status: "connected", status_detail: null, can_send: false,
      },
      { onConflict: "user_id,provider,external_id" },
    ).select("id").single();
    if (error || !acct) throw new Error(error?.message ?? "account upsert failed");

    await db.from("account_secrets").upsert({ account_id: acct.id, tokens_enc: encrypt(JSON.stringify({ access_token: s.token, scope: s.scope })) });
    await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "account.connected", target: s.teamName, meta: { provider: "slack" } });
    await syncAccount(acct.id);
    const res = back(`Connected Slack workspace ${s.teamName}`);
    res.cookies.delete({ name: "slack_oauth", path: "/api/connect/slack" });
    return res;
  } catch (e) {
    return back(`Could not connect Slack: ${(e as Error).message}`);
  }
}

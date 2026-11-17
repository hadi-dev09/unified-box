import { after, NextRequest, NextResponse } from "next/server";
import { ingestSlackEvent, validSlackSignature } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Slack Events API: Slack pushes each new message here the moment it is posted (signed with the app's signing secret).
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.SLACK_SIGNING_SECRET ?? "";
  if (!validSlackSignature(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature"), secret)) {
    return new NextResponse("invalid signature", { status: 401 });
  }
  let body: { type?: string; challenge?: string; team_id?: string; event?: Parameters<typeof ingestSlackEvent>[1]; authorizations?: { user_id?: string; team_id?: string }[] };
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad json", { status: 400 }); }
  if (body.type === "url_verification") return NextResponse.json({ challenge: body.challenge });
  if (body.type !== "event_callback" || !body.event) return NextResponse.json({ ok: true });

  // Deliver only to the people Slack says this event was authorized for (never to others in the same workspace).
  const ids = (body.authorizations ?? []).filter((a) => a.user_id).map((a) => `${a.team_id ?? body.team_id}:${a.user_id}`);
  if (ids.length) {
    const ev = body.event;
    after(async () => {
      const { data: accts } = await supabaseAdmin().from("accounts").select("id, user_id, external_id").eq("provider", "slack").in("external_id", ids);
      for (const a of accts ?? []) await ingestSlackEvent(a, ev).catch(() => {});
    });
  }
  return NextResponse.json({ ok: true }); // answer within 3s so Slack doesn't retry
}

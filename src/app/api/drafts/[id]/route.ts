import { NextRequest, NextResponse } from "next/server";
import { decideDraft, validateEdits } from "@/lib/send";
import { supabaseServer } from "@/lib/supabase/server";

// Approve (send) or reject a pending draft. Requires a signed-in human; AI tokens can't reach this route.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { action, subject, body } = (await req.json().catch(() => ({}))) as { action?: string; subject?: unknown; body?: unknown };
  if (action !== "approve" && action !== "reject") return NextResponse.json({ error: "bad action" }, { status: 400 });
  const v = action === "approve" ? validateEdits(subject, body) : { edits: {} };
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });

  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const r = await decideDraft(user.id, id, action, v.edits);
  return NextResponse.json(r.body, { status: r.status });
}

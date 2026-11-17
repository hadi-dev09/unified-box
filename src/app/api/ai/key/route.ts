import { NextRequest, NextResponse } from "next/server";
import { removeClaudeKey, saveClaudeKey, validateClaudeKey } from "@/lib/ai-assist";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Save (after checking it works) or remove the user's own Claude API key. The key is never sent back to the browser.
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { key } = (await req.json().catch(() => ({}))) as { key?: unknown };
  if (typeof key !== "string") return NextResponse.json({ error: "Paste your API key" }, { status: 400 });
  const v = await validateClaudeKey(key);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  await saveClaudeKey(user.id, key);
  await supabaseAdmin().from("audit_log").insert({ user_id: user.id, actor: "user", action: "ai_key.saved", target: "anthropic" });
  return NextResponse.json({ ok: true, hint: `…${key.trim().slice(-4)}` });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await removeClaudeKey(user.id);
  await supabaseAdmin().from("audit_log").insert({ user_id: user.id, actor: "user", action: "ai_key.removed", target: "anthropic" });
  return NextResponse.json({ ok: true });
}

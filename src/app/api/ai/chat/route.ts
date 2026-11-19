import { NextRequest, NextResponse } from "next/server";
import { buildChatContext, streamChat, type ChatTurn } from "@/lib/ai-chat";
import { currentUser } from "@/lib/auth";

export const maxDuration = 90;

/**
 * The in-app AI assistant. Streams newline-delimited JSON: first the conversation references it may link to,
 * then text as it's written. Read-only: it never sends, deletes or changes anything.
 */
export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { question?: unknown; turns?: unknown; thread_id?: unknown };
  const turns: ChatTurn[] = Array.isArray(b.turns)
    ? (b.turns as { role?: unknown; text?: unknown }[]).filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string").map((t) => ({ role: t.role as "user" | "assistant", text: String(t.text) }))
    : typeof b.question === "string" ? [{ role: "user", text: b.question }] : [];
  const question = turns.at(-1)?.role === "user" ? turns.at(-1)!.text.trim() : "";
  if (!question) return NextResponse.json({ error: "Ask something first" }, { status: 400 });
  const threadId = typeof b.thread_id === "string" && b.thread_id ? b.thread_id : null;
  const { context, refs } = await buildChatContext(user.id, question, threadId, { name: user.name, email: user.email });

  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctl) {
      const send = (o: unknown) => ctl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      send({ type: "refs", refs, me: user.name });
      const r = await streamChat(user.id, turns, context, (t) => send({ type: "text", text: t }));
      send(r.ok ? { type: "done" } : { type: "error", error: r.error, needsKey: r.needsKey ?? false });
      ctl.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

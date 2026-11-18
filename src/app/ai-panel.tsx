"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

type Turn = { role: "you" | "ai"; text: string; reply?: string };

/** Floating "Ask AI" assistant (shown only when the user has connected an AI key). Read-only: it never sends. */
export function AiPanel() {
  const path = usePathname();
  const sp = useSearchParams();
  const threadId = path === "/" ? sp.get("thread") : null;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { setTurns([]); }, [threadId]);
  useEffect(() => { const box = end.current?.parentElement; if (box) box.scrollTop = box.scrollHeight; }, [turns, busy]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setTurns((t) => [...t, { role: "you", text: question }]); setQ(""); setBusy(true);
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, thread_id: threadId }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
      if (!j.ok || !j.text) { setTurns((t) => [...t, { role: "ai", text: j.error ?? "Something went wrong." }]); return; }
      const m = j.text.match(/<reply>([\s\S]*?)<\/reply>/i);
      setTurns((t) => [...t, { role: "ai", text: j.text!.replace(/<\/?reply>/gi, "").trim(), reply: m?.[1]?.trim() }]);
    } finally { setBusy(false); }
  }
  const useReply = (text: string) => { window.dispatchEvent(new CustomEvent("ub:ai-reply", { detail: text })); setOpen(false); };
  const chips = threadId
    ? ["Summarize this conversation", "Draft a reply", "What do they want from me?"]
    : ["What needs my reply today?", "Anything urgent?", "Summarize my unread messages"];

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Ask AI" title="Ask AI"
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-lg)] transition hover:scale-[1.03]">
          <Icon name="spark" /> <span className="hidden sm:inline">Ask AI</span>
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="AI assistant" className="card fixed inset-x-3 bottom-3 z-50 flex max-h-[75vh] flex-col overflow-hidden shadow-[var(--shadow-lg)] sm:inset-x-auto sm:right-5 sm:w-[400px]">
          <header className="flex items-center gap-2 bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] px-4 py-3 text-white">
            <Icon name="spark" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">AI assistant</p><p className="truncate text-xs text-white/80">{threadId ? "About this conversation" : "About your inbox"} · never sends anything</p></div>
            <button onClick={() => setOpen(false)} aria-label="Close AI assistant" className="rounded-md p-1 hover:bg-white/15"><Icon name="close" /></button>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm muted">Try one of these, or ask anything:</p>
                <div className="flex flex-wrap gap-1.5">{chips.map((c) => <button key={c} onClick={() => ask(c)} className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] hover:brightness-95">{c}</button>)}</div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === "you" ? "flex justify-end" : ""}>
                <div className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${t.role === "you" ? "bg-[var(--accent)] text-white" : "bg-[var(--surface-2)]"}`}>{t.text}</div>
                {t.reply && threadId && <button onClick={() => useReply(t.reply!)} className="btn-primary mt-2 !py-1.5 !text-xs"><Icon name="reply" /> Put in reply box</button>}
              </div>
            ))}
            {busy && <p className="inline-flex items-center gap-2 text-sm muted"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" /> Thinking…</p>}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2 border-t border-[var(--border)] p-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={2000} placeholder={threadId ? "Ask about this conversation…" : "Ask about your inbox…"} aria-label="Ask the AI" className="field" />
            <button disabled={busy || !q.trim()} className="btn-primary shrink-0">Ask</button>
          </form>
        </section>
      )}
    </>
  );
}

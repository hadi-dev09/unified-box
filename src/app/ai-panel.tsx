"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { confirmNoPlaceholder, fillNameClient } from "./placeholder";
import { channel, Icon, ProviderIcon } from "./ui";

type Ref = { id: string; title: string; provider: string; who: string };
type Turn = { role: "user" | "assistant"; text: string; refs?: Record<string, Ref>; error?: boolean; me?: string };
const STORE = "ub_ai_chat";

/** Splits an answer into text and <reply to="T3">…</reply> blocks (an unfinished block shows as "writing"). */
function parts(text: string) {
  const out: ({ kind: "text"; text: string } | { kind: "reply"; ref: string; body: string; done: boolean })[] = [];
  const re = /<reply(?:\s+to="?(T\d+)"?)?\s*>([\s\S]*?)(<\/reply>|$)/gi;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "reply", ref: m[1] ?? "", body: m[2].trim(), done: Boolean(m[3]) });
    last = re.lastIndex;
    if (!m[3]) break;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last).replace(/<rep?l?y?[^>]*$/i, "") });
  return out;
}

/** Tiny, safe formatter: **bold**, "- " / "1. " lists, [[T3]] conversation links. No HTML is ever injected. */
function Rich({ text, refs, hrefFor }: { text: string; refs: Record<string, Ref>; hrefFor: (r: Ref) => string }) {
  const inline = (s: string, key: string) => s.split(/(\*\*[^*]+\*\*|\[\[T\d+\]\])/g).map((seg, i) => {
    const b = seg.match(/^\*\*([^*]+)\*\*$/);
    if (b) return <strong key={`${key}-${i}`}>{b[1]}</strong>;
    const r = seg.match(/^\[\[(T\d+)\]\]$/);
    if (r) {
      const ref = refs[r[1]];
      if (!ref) return null;
      return (
        <Link key={`${key}-${i}`} href={hrefFor(ref)} className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 align-middle text-xs font-semibold no-underline hover:brightness-95"
          style={{ background: channel(ref.provider).soft, color: channel(ref.provider).color }}>
          <ProviderIcon provider={ref.provider} className="h-3 w-3 shrink-0" /><span className="truncate">{ref.title}</span><Icon name="chevronRight" className="h-3 w-3 shrink-0" />
        </Link>
      );
    }
    return <Fragment key={`${key}-${i}`}>{seg}</Fragment>;
  });
  const lines = text.replace(/^\n+|\n+$/g, "").split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((l, i) => {
        const li = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (li) return <div key={i} className="flex gap-2"><span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-current opacity-60" /><div className="min-w-0">{inline(li[1], `l${i}`)}</div></div>;
        const h = l.match(/^#{1,4}\s+(.*)$/);
        if (h) return <p key={i} className="font-semibold">{inline(h[1], `h${i}`)}</p>;
        return l.trim() ? <p key={i}>{inline(l, `p${i}`)}</p> : <div key={i} className="h-1" />;
      })}
    </div>
  );
}

function ReplyCard({ refInfo, body, done, hrefFor }: { refInfo?: Ref; body: string; done: boolean; hrefFor: (r: Ref) => string }) {
  const router = useRouter();
  const [text, setText] = useState(body);
  const [state, setState] = useState<"idle" | "busy" | "sent" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  useEffect(() => { setText(body); }, [body]);
  const go = async (action: "send" | "draft") => {
    if (!refInfo) return;
    if (action === "send" && !confirmNoPlaceholder(text)) return;
    setState("busy");
    const r = await fetch("/api/quick-reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ thread_id: refInfo.id, body: text, action }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setState("error"); setMsg(j.error ?? "Failed"); return; }
    setState(action === "send" ? "sent" : "saved"); setMsg(action === "send" ? `Sent${j.to?.length ? ` to ${j.to[0]}` : ""}` : "Saved as a draft in that conversation");
    router.refresh();
  };
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5 text-xs font-semibold" style={{ color: refInfo ? channel(refInfo.provider).color : undefined }}>
        {refInfo ? <><ProviderIcon provider={refInfo.provider} className="h-3.5 w-3.5" /> Reply to {refInfo.title}</> : "Suggested message"}
      </div>
      {done && state !== "sent"
        ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(8, Math.max(2, text.split("\n").length + 1))} aria-label="Edit reply"
            className="block w-full resize-y bg-transparent px-3 py-2 text-sm text-[var(--text)] outline-none" />
        : <p className="whitespace-pre-wrap px-3 py-2 text-sm text-[var(--text)]">{text || "…"}{!done && <span className="ml-1 animate-pulse">▍</span>}</p>}
      {done && refInfo && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] px-2 py-2">
          {state === "sent" || state === "saved"
            ? <span className="inline-flex items-center gap-1 px-1 text-xs font-semibold text-emerald-600"><Icon name="check" className="h-3.5 w-3.5" /> {msg}</span>
            : <>
                <button disabled={state === "busy" || !text.trim()} onClick={() => go("send")} className="btn-primary !px-3 !py-1.5 !text-xs">{state === "busy" ? "Sending…" : "Send"}</button>
                <button disabled={state === "busy"} onClick={() => go("draft")} className="btn !px-2.5 !py-1.5 !text-xs">Save as draft</button>
              </>}
          <Link href={hrefFor(refInfo)} className="ml-auto inline-flex items-center gap-1 px-1 text-xs font-medium text-[var(--accent-text)] hover:underline">Open chat <Icon name="chevronRight" className="h-3 w-3" /></Link>
          {state === "error" && <p className="w-full px-1 text-xs text-red-600">{msg}</p>}
        </div>
      )}
    </div>
  );
}

/** Floating AI assistant (only shown when the user connected an AI key). It answers, links and drafts; you send. */
export function AiPanel() {
  const path = usePathname();
  const sp = useSearchParams();
  const threadId = path === "/" ? sp.get("thread") : null;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => { try { const s = sessionStorage.getItem(STORE); if (s) setTurns(JSON.parse(s)); } catch { /* ignore */ } }, []);
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-20))); } catch { /* ignore */ } }, [turns]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [turns, busy, open]);

  const hrefFor = (r: Ref) => `/?thread=${r.id}`;

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    const history: Turn[] = [...turns.filter((t) => !t.error), { role: "user", text: question }];
    setTurns([...history, { role: "assistant", text: "" }]); setQ(""); setBusy(true);
    const ctl = new AbortController(); abort.current = ctl;
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ thread_id: threadId, turns: history.map((t) => ({ role: t.role, text: t.text })) }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        setTurns((t) => [...t.slice(0, -1), { role: "assistant", text: j.error ?? "Something went wrong.", error: true }]);
        return;
      }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ""; let refs: Record<string, Ref> = {}; let acc = ""; let me = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { type: string; refs?: Record<string, Ref>; text?: string; error?: string; me?: string };
          if (ev.type === "refs") { refs = ev.refs ?? {}; me = ev.me ?? ""; }
          if (ev.type === "text") acc += ev.text ?? "";
          if (ev.type === "error") { setTurns((t) => [...t.slice(0, -1), { role: "assistant", text: ev.error ?? "Failed", error: true }]); return; }
          const snapshot = acc;
          setTurns((t) => [...t.slice(0, -1), { role: "assistant", text: snapshot, refs, me }]);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setTurns((t) => [...t.slice(0, -1), { role: "assistant", text: "Couldn't reach the AI. Check your connection.", error: true }]);
    } finally { setBusy(false); abort.current = null; }
  }

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
        <section role="dialog" aria-label="AI assistant" className="card fixed inset-x-3 bottom-3 z-50 flex max-h-[80vh] flex-col overflow-hidden shadow-[var(--shadow-lg)] sm:inset-x-auto sm:right-5 sm:w-[440px]">
          <header className="flex items-center gap-2 bg-gradient-to-br from-[#4f46e5] to-[#7c3aed] px-4 py-3 text-white">
            <Icon name="spark" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">AI assistant</p><p className="truncate text-xs text-white/80">{threadId ? "Looking at this conversation + your inbox" : "Looking at your whole inbox"} · you press Send</p></div>
            {turns.length > 0 && <button onClick={() => { abort.current?.abort(); setTurns([]); }} className="rounded-md px-2 py-1 text-xs hover:bg-white/15">New chat</button>}
            <button onClick={() => setOpen(false)} aria-label="Close AI assistant" className="rounded-md p-1 hover:bg-white/15"><Icon name="close" /></button>
          </header>
          <div ref={box} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm muted">Ask anything about your messages, or tell me who to write to, e.g. “send a hello to Hadi on Slack”.</p>
                <div className="flex flex-wrap gap-1.5">{chips.map((c) => <button key={c} onClick={() => ask(c)} className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] hover:brightness-95">{c}</button>)}</div>
              </div>
            )}
            {turns.map((t, i) => t.role === "user" ? (
              <div key={i} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--accent)] px-3 py-2 text-sm text-white">{t.text}</div></div>
            ) : (
              <div key={i} className={`max-w-[95%] text-sm leading-relaxed ${t.error ? "rounded-xl bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300" : ""}`}>
                {!t.text && busy && i === turns.length - 1 ? <p className="inline-flex items-center gap-2 muted"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" /> Reading your inbox…</p>
                  : t.error ? t.text
                  : parts(t.text).map((p, j) => p.kind === "text"
                      ? <Rich key={j} text={p.text} refs={t.refs ?? {}} hrefFor={hrefFor} />
                      : <ReplyCard key={j} refInfo={(t.refs ?? {})[p.ref]} body={fillNameClient(p.body, t.me ?? "")} done={p.done} hrefFor={hrefFor} />)}
              </div>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2 border-t border-[var(--border)] p-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={2000} placeholder={threadId ? "Ask about this conversation, or anything…" : "Ask about your inbox, or “message Sara…”"} aria-label="Ask the AI" className="field" />
            {busy ? <button type="button" onClick={() => abort.current?.abort()} className="btn shrink-0">Stop</button> : <button disabled={!q.trim()} className="btn-primary shrink-0">Ask</button>}
          </form>
        </section>
      )}
    </>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "./ui";

async function assist(body: Record<string, unknown>) {
  const r = await fetch("/api/ai/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string; needsKey?: boolean };
}

const IMPROVE = [["Shorter", "make it shorter"], ["More formal", "make it more formal and professional"], ["Friendlier", "make it warmer and friendlier"], ["Fix grammar", "only fix spelling and grammar"]] as const;

/** "Write with AI" for the reply box: draft from a short instruction, or improve what you've written. Uses your own Claude key. */
export function AiHelper({ threadId, hasKey, text, setText }: { threadId: string; hasKey: boolean; text: string; setText: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [undo, setUndo] = useState<string | null>(null);

  if (!hasKey) {
    return <Link href="/settings#ai" className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-text)] hover:underline"><Icon name="spark" className="h-3.5 w-3.5" /> Write with AI: add your AI key</Link>;
  }
  async function run(task: "draft" | "improve", instructions?: string) {
    setBusy(task === "draft" ? "Writing…" : "Improving…"); setErr(null);
    const r = await assist({ thread_id: threadId, task, instructions, text: task === "improve" ? text : undefined });
    setBusy(null);
    if (!r.ok || !r.text) return setErr(r.error ?? "AI failed");
    setUndo(text); setText(r.text); setOpen(false); setAsk("");
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} disabled={Boolean(busy)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/10 px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-500/15 disabled:opacity-60 dark:text-violet-300">
          <Icon name="spark" className="h-3.5 w-3.5" /> {busy ?? "Write with AI"}
        </button>
        {text.trim() && !busy && IMPROVE.map(([label, how]) => (
          <button key={label} type="button" onClick={() => run("improve", how)} className="rounded-lg px-2 py-1.5 text-xs muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]">{label}</button>
        ))}
        {undo !== null && !busy && <button type="button" onClick={() => { setText(undo); setUndo(null); }} className="rounded-lg px-2 py-1.5 text-xs muted hover:bg-[var(--surface-2)]">Undo AI</button>}
      </div>
      {open && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run("draft", ask.trim() || undefined); }}>
          <input autoFocus value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={500} aria-label="What should the reply say?"
            placeholder="What should it say? e.g. “yes, Thursday works, send the invoice Friday” (optional)" className="field !py-1.5 text-sm" />
          <button disabled={Boolean(busy)} className="btn-primary shrink-0 !py-1.5">Draft</button>
        </form>
      )}
      {err && <p className="text-xs text-red-600">{err}{/key/i.test(err) && <> · <Link href="/settings#ai" className="underline">Settings</Link></>}</p>}
      <p className="sr-only" aria-live="polite">{busy ?? ""}</p>
    </div>
  );
}

/** One-click summary of the open conversation (your own Claude key). */
export function AiSummary({ threadId, hasKey }: { threadId: string; hasKey: boolean }) {
  const [out, setOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!hasKey) return null;
  return (
    <div>
      {!out && (
        <button onClick={async () => { setBusy(true); setErr(null); const r = await assist({ thread_id: threadId, task: "summarize" }); setBusy(false); if (r.ok && r.text) setOut(r.text); else setErr(r.error ?? "AI failed"); }}
          disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/10 px-2.5 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-500/15 disabled:opacity-60 dark:text-violet-300">
          <Icon name="spark" className="h-3.5 w-3.5" /> {busy ? "Summarizing…" : "Summarize"}
        </button>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {out && (
        <div className="rounded-2xl border border-violet-300/50 bg-violet-500/5 p-4">
          <div className="mb-1 flex items-center justify-between"><p className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300"><Icon name="spark" className="h-3.5 w-3.5" /> AI summary</p>
            <button onClick={() => setOut(null)} aria-label="Close summary" className="muted hover:text-[var(--text)]"><Icon name="close" className="h-3.5 w-3.5" /></button></div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{out}</p>
        </div>
      )}
    </div>
  );
}

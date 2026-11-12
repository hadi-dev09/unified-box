"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAddressField } from "@/lib/reply";
import { Icon } from "./ui";

type Mode = "reply" | "reply_all" | "forward";
export type Preset = { to: string[]; cc: string[]; subject: string; body: string };

const LABEL: Record<Mode, string> = { reply: "Reply", reply_all: "Reply all", forward: "Forward" };
const field = "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-500 dark:focus:ring-neutral-800";
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800";

export function Composer({ threadId, provider, canSend, showReplyAll, presets, reconnectHref, openHref }: {
  threadId: string; provider: string; canSend: boolean; showReplyAll: boolean;
  presets: Record<Mode, Preset>; reconnectHref: string; openHref: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [to, setTo] = useState(""); const [cc, setCc] = useState(""); const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setMode(null); setDone(null); }, [threadId]);

  function open(m: Mode) {
    const p = presets[m];
    setMode(m); setTo(p.to.join(", ")); setCc(p.cc.join(", ")); setShowCc(p.cc.length > 0);
    setSubject(p.subject); setBody(p.body); setErr(null); setDone(null);
    setTimeout(() => { bodyRef.current?.focus(); bodyRef.current?.setSelectionRange(0, 0); bodyRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 30);
  }

  async function submit(send: boolean) {
    const t = parseAddressField(to), c = parseAddressField(cc);
    if (t.invalid.length || c.invalid.length) return setErr(`Not a valid email: ${[...t.invalid, ...c.invalid].join(", ")}`);
    if (!t.valid.length) return setErr("Add at least one recipient");
    if (!body.trim()) return setErr("Write a message first");
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ thread_id: threadId, mode, to: t.valid, cc: c.valid, subject, body, send }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(j.error ?? `Failed (${res.status})`);
      setDone(send ? "Sent" : "Saved to Approvals"); setMode(null); router.refresh();
    } finally { setBusy(false); }
  }

  if (provider !== "gmail") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {openHref && <a className={btn} href={openHref} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open in Slack</a>}
        <span className="text-xs text-neutral-500">Replying to Slack from Unified Box isn&apos;t available yet.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!mode && (
        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={() => open("reply")}><Icon name="reply" /> Reply</button>
          {showReplyAll && <button className={btn} onClick={() => open("reply_all")}><Icon name="replyAll" /> Reply all</button>}
          <button className={btn} onClick={() => open("forward")}><Icon name="forward" /> Forward</button>
          {openHref && <a className={`${btn} ml-auto`} href={openHref} target="_blank" rel="noopener noreferrer" title="Open this conversation in Gmail"><Icon name="external" /> Gmail</a>}
          {done && <span className="inline-flex items-center gap-1 text-sm text-emerald-600"><Icon name="check" /> {done}</span>}
        </div>
      )}

      {mode && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><Icon name={mode === "reply" ? "reply" : mode === "reply_all" ? "replyAll" : "forward"} /> {LABEL[mode]}</span>
            <button className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Discard" onClick={() => setMode(null)}><Icon name="close" /></button>
          </div>
          {!canSend && (
            <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
              This inbox is connected <b>read-only</b>, so it can&apos;t send yet. You can save this to Approvals, or <a className="underline" href={reconnectHref}>reconnect it with sending</a>.
            </p>
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="w-12 shrink-0 text-xs text-neutral-500" htmlFor="c-to">To</label>
              <input id="c-to" className={field} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" />
              {!showCc && <button className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200" onClick={() => setShowCc(true)}>Cc</button>}
            </div>
            {showCc && (
              <div className="flex items-center gap-2">
                <label className="w-12 shrink-0 text-xs text-neutral-500" htmlFor="c-cc">Cc</label>
                <input id="c-cc" className={field} value={cc} onChange={(e) => setCc(e.target.value)} />
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="w-12 shrink-0 text-xs text-neutral-500" htmlFor="c-sub">Subject</label>
              <input id="c-sub" className={field} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <textarea ref={bodyRef} className={`${field} min-h-40 resize-y leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" />
            {mode === "forward" && <p className="text-xs text-neutral-500">Attachments aren&apos;t forwarded yet; only the text is included.</p>}
          </div>
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canSend && (
              <button disabled={busy} onClick={() => submit(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200">
                {busy ? "Sending…" : "Send"}
              </button>
            )}
            <button disabled={busy} onClick={() => submit(false)} className={btn}>Save to Approvals</button>
            <button disabled={busy} onClick={() => setMode(null)} className="px-2 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

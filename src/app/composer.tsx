"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAddressField } from "@/lib/reply";
import { AiHelper } from "./ai-helper";
import { ScheduleButton, whenLabel } from "./schedule-button";
import { Icon } from "./ui";

type Mode = "reply" | "reply_all" | "forward";

/** Scrolls only the conversation pane (never the whole page) so the element is in view. */
function revealInPane(el: HTMLElement | null) {
  if (!el) return;
  let p = el.parentElement;
  while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
  if (!p) return;
  const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
  if (r.bottom > pr.bottom || r.top < pr.top) p.scrollTo({ top: p.scrollTop + (r.top - pr.top) - pr.height / 3, behavior: "smooth" });
}
export type Preset = { to: string[]; cc: string[]; subject: string; body: string };
export type SavedDraft = { mode: Mode; to: string[]; cc: string[]; subject: string; body: string; savedAt: string };

const APP_NAME: Record<string, string> = { gmail: "Gmail", outlook: "Outlook", slack: "Slack", whatsapp: "WhatsApp", telegram: "Telegram" };
const LABEL: Record<Mode, string> = { reply: "Reply", reply_all: "Reply all", forward: "Forward" };
const field = "field";
const btn = "btn";

export function Composer({ threadId, provider, canSend, showReplyAll, presets, reconnectHref, openHref, hasAiKey = false, saved = null }: {
  threadId: string; provider: string; canSend: boolean; showReplyAll: boolean; hasAiKey?: boolean; saved?: SavedDraft | null;
  presets: Record<Mode, Preset>; reconnectHref: string; openHref: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [to, setTo] = useState(""); const [cc, setCc] = useState(""); const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(""); const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const isChat = provider === "whatsapp" || provider === "telegram" || provider === "slack";
  const restored = useRef<string | null>(null);
  const lastSaved = useRef<string>("");

  // Re-open your unsent reply for this conversation (saved automatically while you typed).
  useEffect(() => {
    setDone(null); setErr(null);
    if (restored.current === threadId) return;
    restored.current = threadId;
    if (saved) {
      if (!isChat) { setMode(saved.mode); setTo(saved.to.join(", ")); setCc(saved.cc.join(", ")); setShowCc(saved.cc.length > 0); setSubject(saved.subject); }
      setBody(saved.body); setSavedNote("Draft restored");
      lastSaved.current = JSON.stringify([saved.mode, saved.to.join(", "), saved.cc.join(", "), saved.subject, saved.body]);
    } else { setMode(null); setBody(""); setSavedNote(null); lastSaved.current = ""; }
  }, [threadId, saved, isChat]);

  // Auto-save ~1s after you stop typing; nothing is sent.
  useEffect(() => {
    const active = isChat ? body.trim().length > 0 : Boolean(mode) && body.trim().length > 0;
    const key = JSON.stringify([mode ?? "reply", to, cc, subject, body]);
    if (!active || key === lastSaved.current || busy) return;
    const t = setTimeout(async () => {
      const r = await fetch("/api/drafts/save", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ thread_id: threadId, mode: mode ?? "reply", to: parseAddressField(to).valid.concat(parseAddressField(to).invalid), cc: parseAddressField(cc).valid, subject, body }) }).catch(() => null);
      if (r?.ok) { lastSaved.current = key; setSavedNote(`Draft saved ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`); }
    }, 1000);
    return () => clearTimeout(t);
  }, [threadId, isChat, mode, to, cc, subject, body, busy]);

  // "Put in reply box" from the AI assistant bubble: open the reply with the AI's text (auto-saved as a draft).
  useEffect(() => {
    const onAi = (e: Event) => {
      const text = String((e as CustomEvent).detail ?? "");
      if (!text) return;
      if (!isChat && !mode) { const p = presets.reply; setMode("reply"); setTo(p.to.join(", ")); setCc(p.cc.join(", ")); setShowCc(p.cc.length > 0); setSubject(p.subject); }
      setBody(text);
      setTimeout(() => revealInPane(bodyRef.current), 50);
    };
    window.addEventListener("ub:ai-reply", onAi);
    return () => window.removeEventListener("ub:ai-reply", onAi);
  }, [isChat, mode, presets]);

  async function discard() {
    setMode(null); setBody(""); setSavedNote(null); lastSaved.current = "";
    await fetch(`/api/drafts/save?thread_id=${encodeURIComponent(threadId)}`, { method: "DELETE" }).catch(() => {});
    router.refresh();
  }

  function open(m: Mode) {
    if (body.trim() && savedNote && !window.confirm("You have a saved draft here. Start a new message instead? (Cancel keeps your draft.)")) { setMode((cur) => cur ?? m); return; }
    const p = presets[m];
    setMode(m); setTo(p.to.join(", ")); setCc(p.cc.join(", ")); setShowCc(p.cc.length > 0);
    setSubject(p.subject); setBody(p.body); setErr(null); setDone(null);
    setTimeout(() => { bodyRef.current?.focus({ preventScroll: true }); bodyRef.current?.setSelectionRange(0, 0); revealInPane(bodyRef.current); }, 30);
  }

  async function submit(sendAt?: string) {
    const t = parseAddressField(to), c = parseAddressField(cc);
    if (t.invalid.length || c.invalid.length) return setErr(`Not a valid email: ${[...t.invalid, ...c.invalid].join(", ")}`);
    if (!t.valid.length) return setErr("Add at least one recipient");
    if (!body.trim()) return setErr("Write a message first");
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ thread_id: threadId, mode, to: t.valid, cc: c.valid, subject, body, send: true, ...(sendAt ? { send_at: sendAt } : {}) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(j.error ?? `Failed (${res.status})`);
      setDone(sendAt ? `Scheduled for ${whenLabel(sendAt)}` : `Sent to ${t.valid.slice(0, 2).join(", ")}${t.valid.length > 2 ? "…" : ""}`); setMode(null); setBody(""); setSavedNote(null); lastSaved.current = "";
      router.refresh();
    } finally { setBusy(false); }
  }

  async function sendChat(sendAt?: string) {
    if (!body.trim()) return setErr("Write a message first");
    setBusy(true); setErr(null); setDone(null);
    try {
      const res = await fetch("/api/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ thread_id: threadId, body, send: true, ...(sendAt ? { send_at: sendAt } : {}) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setErr(j.error ?? `Failed (${res.status})`);
      setBody(""); setSavedNote(null); lastSaved.current = ""; setDone(sendAt ? `Scheduled for ${whenLabel(sendAt)}` : "Sent"); router.refresh();
    } finally { setBusy(false); }
  }

  const appName = APP_NAME[provider] ?? provider;
  if (provider === "whatsapp" || provider === "telegram" || provider === "slack") {
    return (
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); sendChat(); }}>
        {canSend && <AiHelper threadId={threadId} hasKey={hasAiKey} text={body} setText={setBody} />}
        <label htmlFor="c-chat" className="sr-only">Message</label>
        <div className="flex items-end gap-2">
          <textarea id="c-chat" ref={bodyRef} rows={2} className={`${field} min-h-11 resize-y`} value={body} maxLength={4096} disabled={!canSend}
            onChange={(e) => setBody(e.target.value)} placeholder={canSend ? `Message on ${appName}…` : `Connected read-only. Reconnect to reply here.`}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
          <button disabled={busy || !canSend} className="btn-primary !py-2.5">{busy ? "Sending…" : "Send"}</button>
          {canSend && <ScheduleButton disabled={busy || !body.trim()} onPick={(iso) => sendChat(iso)} />}
        </div>
        {!canSend && <p className="text-xs text-amber-800 dark:text-amber-300">Replies are off for this connection. <a className="font-semibold underline" href={reconnectHref}>Reconnect with replies</a>{openHref && <> or <a className="underline" href={openHref} target="_blank" rel="noopener noreferrer">open in {appName}</a></>}.</p>}
        {savedNote && body.trim() && <p className="flex items-center gap-2 text-xs muted"><Icon name="check" className="h-3 w-3" />{savedNote}<button type="button" onClick={discard} className="font-medium hover:text-red-600">Discard draft</button></p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        {done && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{done}</p>}
        {provider === "whatsapp" && <p className="text-xs text-neutral-500">WhatsApp only allows free-form replies within 24 hours of the customer&apos;s last message.</p>}
      </form>
    );
  }
  if (provider !== "gmail" && provider !== "outlook") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {openHref && <a className={btn} href={openHref} target="_blank" rel="noopener noreferrer"><Icon name="external" /> Open in {appName}</a>}
        <span className="text-xs text-neutral-500">Replying to {appName} from Unified Box isn&apos;t available yet.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!mode && (
        <div className="flex flex-wrap items-center gap-2">
          {body.trim() && savedNote && <button className="btn-primary" onClick={() => setMode((m) => m ?? "reply")}><Icon name="pencil" /> Continue draft</button>}
          <button className={btn} onClick={() => open("reply")}><Icon name="reply" /> Reply</button>
          {showReplyAll && <button className={btn} onClick={() => open("reply_all")}><Icon name="replyAll" /> Reply all</button>}
          <button className={btn} onClick={() => open("forward")}><Icon name="forward" /> Forward</button>
          {openHref && <a className={`${btn} ml-auto`} href={openHref} target="_blank" rel="noopener noreferrer" title={`Open this conversation in ${appName}`}><Icon name="external" /> {appName}</a>}
          {done && <span role="status" className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-sm font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"><Icon name="check" /> {done}</span>}
        </div>
      )}

      {mode && (
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold"><Icon name={mode === "reply" ? "reply" : mode === "reply_all" ? "replyAll" : "forward"} /> {LABEL[mode]}</span>
            <span className="flex items-center gap-2">{savedNote && <span className="inline-flex items-center gap-1 text-xs muted"><Icon name="check" className="h-3 w-3" />{savedNote}</span>}
            <button className="rounded-md p-1 muted hover:bg-[var(--surface-2)]" aria-label="Close (draft is kept)" title="Close (draft is kept)" onClick={() => setMode(null)}><Icon name="close" /></button></span>
          </div>
          {!canSend && (
            <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
              This inbox is connected <b>read-only</b>, so it can&apos;t send yet. <a className="font-semibold underline" href={reconnectHref}>Reconnect it with sending</a> (one click on the sign-in screen), then reply here.
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
            <AiHelper threadId={threadId} hasKey={hasAiKey} text={body} setText={setBody} />
            <textarea ref={bodyRef} className={`${field} min-h-40 resize-y leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" />
            {mode === "forward" && <p className="text-xs text-neutral-500">Attachments aren&apos;t forwarded yet; only the text is included.</p>}
          </div>
          {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canSend && (
              <button disabled={busy} onClick={() => submit()} className="btn-primary">
                {busy ? "Sending…" : "Send"}
              </button>
            )}
            {canSend && <ScheduleButton disabled={busy} onPick={(iso) => submit(iso)} />}
            <button disabled={busy} onClick={discard} className="px-2 text-sm muted hover:text-red-600">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

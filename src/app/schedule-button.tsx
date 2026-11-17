"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

/** "Tue, Nov 18, 08:00 AM" in the viewer's own time. */
export const whenLabel = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function at(daysAhead: number, h: number, nextWeekday?: number) {
  const d = new Date();
  if (nextWeekday !== undefined) d.setDate(d.getDate() + (((nextWeekday - d.getDay() + 7) % 7) || 7));
  else d.setDate(d.getDate() + daysAhead);
  d.setHours(h, 0, 0, 0);
  return d;
}

/** Clock button next to Send: pick when the message should go out. */
export function ScheduleButton({ onPick, disabled }: { onPick: (iso: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [up, setUp] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const later = new Date(Date.now() + 3 * 3600_000); later.setMinutes(0, 0, 0);
  const options: [string, Date][] = [
    ["In 3 hours", later],
    ["Tomorrow morning", at(1, 8)],
    ["Tomorrow afternoon", at(1, 13)],
    ["Monday morning", at(0, 8, 1)],
  ];
  const pick = (d: Date) => { setOpen(false); onPick(d.toISOString()); };
  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={disabled} onClick={() => { setUp((ref.current?.getBoundingClientRect().top ?? 999) > 380); setOpen((o) => !o); }} aria-haspopup="menu" aria-expanded={open}
        className="btn !py-2.5" title="Schedule send" aria-label="Schedule send"><Icon name="clock" /><span className="hidden sm:inline">Schedule</span></button>
      {open && (
        <div role="menu" className={`card absolute right-0 z-40 w-72 p-1 shadow-[var(--shadow-lg)] ${up ? "bottom-12" : "top-12"}`}>
          <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider muted">Schedule send</p>
          {options.map(([label, d]) => (
            <button key={label} type="button" role="menuitem" onClick={() => pick(d)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]">
              {label}<span className="text-xs muted">{whenLabel(d.toISOString())}</span>
            </button>
          ))}
          <div className="flex items-center gap-2 border-t border-[var(--border)] px-2 pb-1 pt-2">
            <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Pick date and time" className="field !py-1.5 text-sm" />
            <button type="button" disabled={!custom} onClick={() => pick(new Date(custom))} className="btn-primary !px-3 !py-1.5">Set</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A scheduled reply shown inside its conversation, with Send now / Cancel. */
export function ScheduledCard({ id, sendAt, body, to }: { id: string; sendAt: string; body: string; to: string }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<string | null>(null);
  const act = async (action: "cancel" | "send_now") => {
    setBusy(true);
    const r = await fetch(`/api/drafts/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setState(r.ok ? (action === "cancel" ? "Cancelled. It won't be sent." : "Sent.") : j.error ?? "Failed");
    if (r.ok) setTimeout(() => location.reload(), 600);
  };
  return (
    <div className="rounded-2xl border border-sky-300/60 bg-sky-500/5 p-4">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300"><Icon name="clock" className="h-3.5 w-3.5" /> Scheduled for {whenLabel(sendAt)}</p>
      <p className="mt-0.5 text-xs muted">{to}</p>
      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm">{body}</p>
      {state ? <p role="status" className="mt-2 text-sm font-medium">{state}</p> : (
        <div className="mt-3 flex gap-2">
          <button disabled={busy} onClick={() => act("send_now")} className="btn-primary !py-1.5">Send now</button>
          <button disabled={busy} onClick={() => act("cancel")} className="btn !py-1.5 !text-red-600">Cancel</button>
        </div>
      )}
    </div>
  );
}

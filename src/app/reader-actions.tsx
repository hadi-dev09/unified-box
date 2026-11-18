"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Icon, type IconName } from "./ui";

/** Actions for the open conversation: star, mark unread, snooze, delete. */
export function ReaderActions({ id, starred, closeHref }: { id: string; starred: boolean; closeHref: string }) {
  const router = useRouter();
  const [star, setStar] = useState(starred);
  const [menu, setMenu] = useState(false);
  const [, start] = useTransition();
  useEffect(() => { setStar(starred); }, [starred]);
  const call = (action: string, until?: string, leave = false) => start(async () => {
    await fetch("/api/threads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id], action, until }) });
    if (leave) { window.dispatchEvent(new Event("ub:navigating")); router.push(closeHref); }
    router.refresh();
  });
  const btn = (icon: IconName, label: string, onClick: () => void, cls = "") => (
    <button onClick={onClick} title={label} aria-label={label} className={`inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[var(--surface-2)] ${cls || "muted hover:text-[var(--text)]"}`}><Icon name={icon} className="h-4 w-4" /></button>
  );
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); };
  return (
    <div className="relative flex shrink-0 items-center gap-0.5">
      {btn(star ? "starFill" : "star", star ? "Unstar" : "Star", () => { setStar(!star); call(star ? "unstar" : "star"); }, star ? "text-amber-400" : "")}
      {btn("mail", "Mark unread", () => call("unread", undefined, true))}
      {btn("clock", "Snooze", () => setMenu((m) => !m))}
      {btn("trash", "Delete", () => call("trash", undefined, true), "muted hover:text-red-600")}
      {menu && (
        <div className="card absolute right-0 top-9 z-30 w-56 p-1 shadow-[var(--shadow-lg)]">
          {[["In 3 hours", new Date(Date.now() + 3 * 3600_000).toISOString()], ["Tomorrow 9:00 AM", tomorrow()], ["In a week", new Date(Date.now() + 7 * 86400_000).toISOString()]].map(([l, at]) => (
            <button key={l} onClick={() => { setMenu(false); call("snooze", at, true); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]">{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Scrolls an AI draft into view when you arrive from the AI drafts page. */
export function ScrollToDraft({ id }: { id: string }) {
  useEffect(() => { const el = document.getElementById(`draft-${id}`); let p = el?.parentElement ?? null;
    while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
    if (el && p) p.scrollTo({ top: p.scrollTop + el.getBoundingClientRect().top - p.getBoundingClientRect().top - 80, behavior: "smooth" }); }, [id]);
  return null;
}

/** Chats open at the newest message (bottom), like a messaging app. */
export function ScrollToBottom() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let p = ref.current?.parentElement ?? null;
    while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
    if (p) p.scrollTop = p.scrollHeight;
  }, []);
  return <span ref={ref} aria-hidden />;
}

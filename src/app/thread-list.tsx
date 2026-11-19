"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { LocalTime } from "./local-time";
import { Avatar, ChannelTag, Icon, type IconName } from "./ui";

export type ListThread = {
  id: string; subject: string | null; snippet: string | null; last_message_at: string; unread: boolean; needs_reply: boolean;
  last_from: string | null; starred: boolean; snoozed_until: string | null; trashed_at: string | null;
  provider: string | null; accountLabel: string; client: string | null; hasDraft?: boolean;
};

const SNOOZE = [
  { label: "Later today (3 hours)", at: () => new Date(Date.now() + 3 * 3600_000) },
  { label: "Tomorrow, 9:00 AM", at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
  { label: "This weekend (Sat 9:00 AM)", at: () => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; } },
  { label: "Next week (Mon 9:00 AM)", at: () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; } },
];

/**
 * Slack rows read like Slack's Activity view: the person on top, and under the message where it was posted
 * ("Direct message", "#general", "Thread in Direct message", "Thread in #general").
 */
function slackRow(t: ListThread) {
  const subject = t.subject ?? "";
  const thread = subject.startsWith("Thread in ");
  const base = thread ? subject.slice("Thread in ".length) : subject;
  const dm = base.match(/^DM · (.+)$/);
  const group = base.startsWith("Group DM");
  const place = dm ? "Direct message" : group ? "Group message" : base;
  const person = t.last_from && t.last_from !== "You" ? t.last_from : dm ? dm[1] : base;
  return { who: person || "(unknown)", where: thread ? `Thread in ${place}` : place, thread, channel: !dm && !group };
}

async function act(ids: string[], action: string, until?: string) {
  const r = await fetch("/api/threads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, action, until }) });
  return (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; note?: string; count?: number };
}

/** The conversation list: click to open, tick to select many, hover for quick actions. */
export function ThreadList({ threads, activeId, hrefFor, showChannel, view }: {
  threads: ListThread[]; activeId: string | null; hrefFor: Record<string, string>; showChannel: boolean; view: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState<Record<string, Partial<ListThread>>>({});
  const [snoozeFor, setSnoozeFor] = useState<string[] | null>(null);

  useEffect(() => { setHidden(new Set()); setOverride({}); setSel((s) => new Set([...s].filter((id) => threads.some((t) => t.id === id)))); }, [threads]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t); }, [toast]);

  const rows = useMemo(() => threads.filter((t) => !hidden.has(t.id)).map((t) => ({ ...t, ...override[t.id] })), [threads, hidden, override]);
  const selected = rows.filter((t) => sel.has(t.id));
  const allOn = rows.length > 0 && selected.length === rows.length;

  function run(ids: string[], action: string, until?: string, label?: string) {
    if (!ids.length) return;
    // Optimistic: update the list immediately, then confirm with the server.
    if (["trash", "restore", "snooze", "unsnooze"].includes(action)) setHidden((h) => new Set([...h, ...ids]));
    const patch: Partial<ListThread> | null = action === "read" ? { unread: false } : action === "unread" ? { unread: true } : action === "star" ? { starred: true } : action === "unstar" ? { starred: false } : null;
    if (patch) setOverride((o) => ({ ...o, ...Object.fromEntries(ids.map((id) => [id, { ...o[id], ...patch }])) }));
    setSel(new Set());
    start(async () => {
      const r = await act(ids, action, until);
      if (!r.ok) { setToast(r.error ?? "Something went wrong"); setHidden(new Set()); setOverride({}); return; }
      setToast(r.note ?? `${label ?? "Done"}${ids.length > 1 ? ` · ${ids.length} conversations` : ""}`);
      router.refresh();
    });
  }

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const anyUnread = selected.some((t) => t.unread);
  const anyUnstarred = selected.some((t) => !t.starred);
  const ids = selected.map((t) => t.id);

  return (
    <div className="relative">
      {rows.length > 0 && (
        <div className={`sticky top-0 z-10 mb-1 flex h-11 items-center gap-1 rounded-xl px-2 transition ${selected.length ? "bg-[var(--surface)] shadow-[var(--shadow)] ring-1 ring-[var(--border)]" : "bg-[var(--bg)]"}`}>
          <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--surface-2)]" title={allOn ? "Clear selection" : "Select all"}>
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={allOn} ref={(el) => { if (el) el.indeterminate = selected.length > 0 && !allOn; }}
              onChange={() => setSel(allOn ? new Set() : new Set(rows.map((t) => t.id)))} aria-label="Select all conversations" />
          </label>
          {selected.length > 0 ? (
            <>
              <span className="mr-1 text-sm font-semibold">{selected.length} selected</span>
              <Bulk icon={anyUnread ? "mailOpen" : "mail"} label={anyUnread ? "Mark read" : "Mark unread"} onClick={() => run(ids, anyUnread ? "read" : "unread", undefined, anyUnread ? "Marked read" : "Marked unread")} />
              <Bulk icon={anyUnstarred ? "star" : "starFill"} label={anyUnstarred ? "Star" : "Unstar"} onClick={() => run(ids, anyUnstarred ? "star" : "unstar", undefined, anyUnstarred ? "Starred" : "Unstarred")} />
              {view === "snoozed" ? <Bulk icon="clock" label="Unsnooze" onClick={() => run(ids, "unsnooze", undefined, "Back in inbox")} />
                : view !== "trash" && <Bulk icon="clock" label="Snooze" onClick={() => setSnoozeFor(ids)} />}
              {view === "trash" ? <Bulk icon="inbox" label="Restore" onClick={() => run(ids, "restore", undefined, "Restored")} />
                : <Bulk icon="trash" label="Delete" danger onClick={() => run(ids, "trash", undefined, "Moved to trash")} />}
              <button onClick={() => setSel(new Set())} className="ml-auto rounded-lg px-2 py-1 text-xs muted hover:bg-[var(--surface-2)]">Cancel</button>
            </>
          ) : <span className="text-xs muted">{rows.length} conversation{rows.length === 1 ? "" : "s"}</span>}
        </div>
      )}

      <ul className="space-y-1">
        {rows.map((t) => {
          const active = activeId === t.id;
          const isChat = Boolean(t.provider && !["gmail", "outlook"].includes(t.provider));
          const slack = t.provider === "slack" ? slackRow(t) : null;
          const who = slack ? slack.who : isChat ? t.subject || t.last_from || "(unknown)" : t.last_from || "(unknown)";
          const checked = sel.has(t.id);
          return (
            <li key={t.id} className="group/row relative">
              <Link href={hrefFor[t.id]} aria-current={active ? "true" : undefined} prefetch={false}
                onMouseEnter={() => router.prefetch(hrefFor[t.id])} onTouchStart={() => router.prefetch(hrefFor[t.id])}
                onClick={() => t.unread && setOverride((o) => ({ ...o, [t.id]: { ...o[t.id], unread: false } }))}
                className={`relative flex items-start gap-3 rounded-2xl py-3 pl-11 pr-3 transition ${
                  active ? "bg-[var(--surface)] shadow-[var(--shadow)] ring-1 ring-[var(--accent)]/50"
                  : checked ? "bg-[var(--accent-soft)]"
                  : t.unread ? "bg-[var(--surface)] shadow-[var(--shadow)] ring-1 ring-[var(--border)] hover:ring-[var(--border-strong)]"
                  : "hover:bg-[var(--surface)]/70"}`}>
                {t.unread && <span className="absolute inset-y-3 left-1.5 w-1 rounded-full bg-[var(--unread)]" aria-hidden />}
                {t.unread && <span className="sr-only">Unread. </span>}
                <Avatar name={who} you={who === "You"} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`truncate text-sm ${t.unread ? "font-bold" : "font-medium text-[var(--text)]/80"}`}>{who}</span>
                    {t.starred && <Icon name="starFill" className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                    <span className={`ml-auto shrink-0 text-xs tabular-nums group-hover/row:invisible ${t.unread ? "font-semibold text-[var(--accent-text)]" : "muted"}`}><LocalTime iso={t.last_message_at} /></span>
                  </div>
                  {!isChat && <p className={`truncate text-sm ${t.unread ? "font-semibold" : "text-[var(--text)]/75"}`}>{t.subject || "(no subject)"}</p>}
                  <p className={`truncate text-[13px] ${slack && t.unread ? "text-[var(--text)]" : "muted"}`}>{isChat && t.last_from === "You" ? "You: " : ""}{t.snippet}</p>
                  {slack && (
                    <p className="mt-1 flex items-center gap-1 truncate text-xs muted">
                      <Icon name={slack.thread ? "reply" : slack.channel ? "hash" : "chat"} className="h-3 w-3 shrink-0" />
                      <span className="truncate">{slack.where}</span>
                    </p>
                  )}
                  {(showChannel || t.client || t.snoozed_until || t.hasDraft) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {showChannel && <ChannelTag provider={t.provider} label={t.accountLabel} />}
                      {t.client && <span className="chip bg-violet-500/12 text-violet-700 dark:text-violet-300">{t.client}</span>}
                      {t.hasDraft && <span className="chip bg-red-500/12 text-red-700 dark:text-red-300"><Icon name="pencil" className="h-3 w-3" />Draft</span>}
                      {t.snoozed_until && <span className="chip bg-sky-500/12 text-sky-700 dark:text-sky-300"><Icon name="clock" className="h-3 w-3" />Until <LocalTime iso={t.snoozed_until} /></span>}
                    </div>
                  )}
                </div>
              </Link>
              <label className={`absolute left-2 top-3.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--surface-3)] ${checked || selected.length ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100"} max-md:opacity-100`}>
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={checked} onChange={() => toggle(t.id)} aria-label={`Select ${who}`} />
              </label>
              <div className="absolute right-2 top-2 hidden items-center gap-0.5 rounded-xl bg-[var(--surface)] p-0.5 shadow-[var(--shadow)] ring-1 ring-[var(--border)] md:group-hover/row:flex">
                <Quick icon={t.unread ? "mailOpen" : "mail"} label={t.unread ? "Mark read" : "Mark unread"} onClick={() => run([t.id], t.unread ? "read" : "unread", undefined, t.unread ? "Marked read" : "Marked unread")} />
                <Quick icon={t.starred ? "starFill" : "star"} label={t.starred ? "Unstar" : "Star"} onClick={() => run([t.id], t.starred ? "unstar" : "star", undefined, t.starred ? "Unstarred" : "Starred")} />
                {view === "snoozed" ? <Quick icon="clock" label="Unsnooze" onClick={() => run([t.id], "unsnooze", undefined, "Back in inbox")} />
                  : view !== "trash" && <Quick icon="clock" label="Snooze" onClick={() => setSnoozeFor([t.id])} />}
                {view === "trash" ? <Quick icon="inbox" label="Restore" onClick={() => run([t.id], "restore", undefined, "Restored")} />
                  : <Quick icon="trash" label="Delete" onClick={() => run([t.id], "trash", undefined, "Moved to trash")} />}
              </div>
            </li>
          );
        })}
      </ul>

      {snoozeFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Snooze until" onClick={() => setSnoozeFor(null)}>
          <div className="card w-full max-w-sm p-2" onClick={(e) => e.stopPropagation()}>
            <p className="px-3 pb-1 pt-2 text-sm font-semibold">Snooze until…</p>
            <p className="px-3 pb-2 text-xs muted">It leaves your inbox and comes back as unread at that time.</p>
            {SNOOZE.map((o) => (
              <button key={o.label} onClick={() => { const ids = snoozeFor; setSnoozeFor(null); run(ids, "snooze", o.at().toISOString(), "Snoozed"); }}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm hover:bg-[var(--surface-2)]">
                {o.label}<span className="text-xs muted">{o.at().toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </button>
            ))}
            <SnoozeCustom onPick={(iso) => { const ids = snoozeFor; setSnoozeFor(null); run(ids, "snooze", iso, "Snoozed"); }} />
            <button onClick={() => setSnoozeFor(null)} className="mt-1 w-full rounded-xl px-3 py-2 text-sm muted hover:bg-[var(--surface-2)]">Cancel</button>
          </div>
        </div>
      )}
      {(toast || busy) && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-white dark:text-neutral-900">
          {busy && !toast ? "Saving…" : toast}
        </div>
      )}
    </div>
  );
}

function SnoozeCustom({ onPick }: { onPick: (iso: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form className="flex items-center gap-2 px-3 py-2" onSubmit={(e) => { e.preventDefault(); if (v) onPick(new Date(v).toISOString()); }}>
      <input type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} className="field !py-1.5 text-sm" aria-label="Pick date and time" />
      <button disabled={!v} className="btn-primary !px-3 !py-1.5">Set</button>
    </form>
  );
}

function Bulk({ icon, label, onClick, danger }: { icon: IconName; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} title={label} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium hover:bg-[var(--surface-2)] ${danger ? "text-red-600 dark:text-red-400" : ""}`}>
      <Icon name={icon} className="h-4 w-4" /><span className="hidden sm:inline">{label}</span>
    </button>
  );
}
function Quick({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }} title={label} aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[var(--surface-2)] ${icon === "starFill" ? "text-amber-400" : "muted hover:text-[var(--text)]"}`}>
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}

"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { accountName, channel, Icon, ProviderIcon } from "./ui";

type Hit = { id: string; subject: string | null; snippet: string | null; last_from: string | null; unread: boolean; accounts: { provider: string; display_name: string; label: string | null } | null };

/** Search with instant top matches. Enter shows every match; ✕ clears and goes back to the inbox. */
export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setQ(initial), [initial]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setTotal(0); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        const j = (await r.json()) as { results?: Hit[]; total?: number };
        setHits(j.results ?? []); setTotal(j.total ?? 0); setCursor(-1);
      } catch { /* aborted */ } finally { setLoading(false); }
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (params: Record<string, string | undefined>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(params)) { if (v) p.set(k, v); else p.delete(k); }
    setOpen(false);
    window.dispatchEvent(new Event("ub:navigating"));
    router.push(p.size ? `/?${p}` : "/");
  };
  const submit = () => go({ q: q.trim() || undefined, thread: undefined });
  const clear = () => { setQ(""); setHits([]); go({ q: undefined, thread: undefined }); };

  return (
    <div ref={box} className="relative w-full">
      <form role="search" onSubmit={(e) => { e.preventDefault(); if (cursor >= 0 && hits[cursor]) go({ thread: hits[cursor].id }); else submit(); }}
        className="flex items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 ring-1 ring-transparent transition focus-within:bg-[var(--surface)] focus-within:ring-[var(--accent)]/60">
        <Icon name="search" className="h-4 w-4 shrink-0 muted" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search messages, people, channels"
          aria-label="Search" aria-autocomplete="list" aria-expanded={open && hits.length > 0} autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, -1)); }
            if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); }
          }}
          className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]" />
        {loading && <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" />}
        {(q || initial) && (
          <button type="button" onClick={clear} aria-label="Clear search" title="Clear search" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md muted hover:bg-[var(--surface-3)] hover:text-[var(--text)]">
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        )}
      </form>
      {open && q.trim().length >= 2 && !loading && (hits.length > 0 || total === 0) && (
        <div className="card absolute inset-x-0 top-11 z-40 overflow-hidden p-1.5 shadow-[var(--shadow-lg)]" role="listbox">
          {hits.length === 0 ? <p className="px-3 py-3 text-sm muted">No matches for “{q.trim()}”</p> : hits.map((h, i) => {
            const c = channel(h.accounts?.provider);
            return (
              <button key={h.id} role="option" aria-selected={cursor === i} onMouseEnter={() => setCursor(i)} onClick={() => go({ thread: h.id })}
                className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left ${cursor === i ? "bg-[var(--surface-2)]" : ""}`}>
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white" style={{ background: c.color }}><ProviderIcon provider={h.accounts?.provider} className="h-3.5 w-3.5" /></span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${h.unread ? "font-semibold" : ""}`}>{h.subject || h.last_from || "(no subject)"}</span>
                  <span className="block truncate text-xs muted">{h.last_from} · {h.accounts ? accountName(h.accounts) : ""} — {h.snippet}</span>
                </span>
              </button>
            );
          })}
          {total > 0 && (
            <button onClick={submit} className="mt-1 flex w-full items-center justify-between rounded-xl border-t border-[var(--border)] px-3 py-2 text-left text-sm font-medium text-[var(--accent-text)] hover:bg-[var(--surface-2)]">
              Show all {total > 39 ? "40+" : total} results <span className="text-xs muted">Enter ↵</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

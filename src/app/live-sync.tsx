"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const POLL_MS = 20_000;

function ago(iso: string | null, now: number) {
  if (!iso) return "not synced yet";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/**
 * Keeps the inbox fresh: the server syncs every minute (and Slack/WhatsApp push instantly); this asks for a tiny
 * fingerprint every 20s while the tab is visible and reloads the screen only when something changed.
 */
export function LiveSync({ enabled, lastSyncedAt }: { enabled: boolean; lastSyncedAt: string | null; unreadTotal?: number }) {
  const router = useRouter();
  const [at, setAt] = useState(lastSyncedAt);
  const [state, setState] = useState<"idle" | "syncing" | "error">("idle");
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const version = useRef<string | null>(null);

  useEffect(() => { setAt((prev) => (lastSyncedAt && (!prev || lastSyncedAt > prev) ? lastSyncedAt : prev)); }, [lastSyncedAt]);

  const check = useCallback(async () => {
    if (!enabled || busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    try {
      const r = await fetch("/api/sync", { method: "POST", cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { version: string; lastSynced: string | null; syncing?: boolean };
      setState(j.syncing ? "syncing" : "idle");
      if (j.lastSynced) setAt(j.lastSynced);
      if (version.current !== null && j.version !== version.current) router.refresh();
      version.current = j.version;
      if (j.syncing) setTimeout(() => { busy.current = false; check(); }, 6000);
    } catch { setState("error"); }
    finally { busy.current = false; }
  }, [enabled, router]);

  useEffect(() => {
    if (!enabled) return;
    check();
    const poll = setInterval(check, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") { setNow(Date.now()); check(); } };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { clearInterval(poll); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [enabled, check]);

  // Instant updates: the database tells this tab the moment one of your conversations changes (new message, read in
  // Slack, …), so the screen refreshes within a second instead of waiting for the 20s check. Row-level security
  // limits this to your own conversations.
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!enabled || !url || !key || url.includes("fake.supabase")) return;
    const sb = createBrowserClient(url, key);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ch = sb.channel("ub-live").on("postgres_changes", { event: "*", schema: "public", table: "threads" }, () => {
      clearTimeout(timer); timer = setTimeout(() => { busy.current = false; check(); }, 300);
    }).subscribe();
    return () => { clearTimeout(timer); sb.removeChannel(ch); };
  }, [enabled, check]);

  if (!enabled) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-[var(--muted)]" role="status" aria-live="polite" title="New messages arrive automatically">
      <span className={`h-1.5 w-1.5 rounded-full ${state === "syncing" ? "animate-pulse bg-[var(--accent)]" : state === "error" ? "bg-amber-500" : "bg-emerald-500"}`} />
      <span className="hidden sm:inline">{state === "syncing" ? "Syncing…" : state === "error" ? "Offline, retrying" : `Updated ${ago(at, now)}`}</span>
    </span>
  );
}

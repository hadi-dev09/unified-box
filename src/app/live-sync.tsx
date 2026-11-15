"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 60_000;

function ago(iso: string | null, now: number) {
  if (!iso) return "not synced yet";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/**
 * Keeps the inbox fresh without a Sync button: checks for new mail when the app opens, every minute while the tab
 * is visible, and when you come back to the tab. Refreshes the screen only when something changed.
 */
export function LiveSync({ enabled, lastSyncedAt }: { enabled: boolean; lastSyncedAt: string | null; unreadTotal?: number }) {
  const router = useRouter();
  const [at, setAt] = useState(lastSyncedAt);
  const [state, setState] = useState<"idle" | "syncing" | "error">("idle");
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const lastRefresh = useRef(Date.now());

  useEffect(() => setAt(lastSyncedAt), [lastSyncedAt]);

  const check = useCallback(async () => {
    if (!enabled || busy.current || document.visibilityState !== "visible") return;
    busy.current = true; setState("syncing");
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { changed?: boolean; results?: unknown[] };
      if (j.results?.length) setAt(new Date().toISOString());
      // Refresh when mail changed, or every 5 minutes anyway (assistants and other devices can change things too).
      if (j.changed || Date.now() - lastRefresh.current > 5 * 60_000) { lastRefresh.current = Date.now(); router.refresh(); }
      setState("idle");
    } catch { setState("error"); }
    finally { busy.current = false; }
  }, [enabled, router]);

  useEffect(() => {
    if (!enabled) return;
    check();
    const poll = setInterval(check, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 20_000);
    const onVisible = () => { if (document.visibilityState === "visible") { setNow(Date.now()); check(); } };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { clearInterval(poll); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); };
  }, [enabled, check]);

  if (!enabled) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-neutral-500" role="status" aria-live="polite" title="Unified Box checks for new mail automatically every minute">
      <span className={`h-1.5 w-1.5 rounded-full ${state === "syncing" ? "animate-pulse bg-blue-500" : state === "error" ? "bg-amber-500" : "bg-emerald-500"}`} />
      <span className="hidden sm:inline">{state === "syncing" ? "Checking for mail…" : state === "error" ? "Offline, retrying" : `Updated ${ago(at, now)}`}</span>
    </span>
  );
}

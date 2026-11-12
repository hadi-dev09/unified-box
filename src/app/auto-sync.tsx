"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

const STALE_MS = 5 * 60_000;

/** Quietly refreshes mail when the page is opened and the data is stale (at most once per 5 min per tab). */
export function AutoSync({ lastSyncedAt, enabled }: { lastSyncedAt: string | null; enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    if (lastSyncedAt && Date.now() - new Date(lastSyncedAt).getTime() < STALE_MS) return;
    try {
      const ran = Number(sessionStorage.getItem("autosync") ?? 0);
      if (Date.now() - ran < STALE_MS) return;
      sessionStorage.setItem("autosync", String(Date.now()));
    } catch { /* storage unavailable: still sync once per mount */ }
    fetch("/api/sync", { method: "POST" }).then(() => router.refresh()).catch(() => {});
  }, [enabled, lastSyncedAt, router]);
  return null;
}

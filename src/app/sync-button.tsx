"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      disabled={busy}
      title="Fetch new messages"
      onClick={async () => { setBusy(true); try { await fetch("/api/sync", { method: "POST" }); } finally { setBusy(false); router.refresh(); } }}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-neutral-700 transition hover:bg-white disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-900"
    >
      <svg viewBox="0 0 24 24" className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
      </svg>
      <span className="hidden sm:inline">{busy ? "Syncing…" : "Sync"}</span>
    </button>
  );
}

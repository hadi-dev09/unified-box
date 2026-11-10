"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SyncButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      disabled={busy}
      onClick={async () => { setBusy(true); try { await fetch("/api/sync", { method: "POST" }); } finally { setBusy(false); router.refresh(); } }}
      className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700"
    >{busy ? "Syncing…" : "Sync"}</button>
  );
}

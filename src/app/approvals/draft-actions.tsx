"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DraftActions({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function act(action: "approve" | "reject") {
    setBusy(true);
    try { await fetch(`/api/drafts/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); }
    finally { setBusy(false); router.refresh(); }
  }
  return (
    <div className="mt-3 flex gap-2">
      <button disabled={busy} onClick={() => act("approve")} className="rounded bg-green-600 px-4 py-2 text-sm text-white disabled:opacity-50">Approve &amp; send</button>
      <button disabled={busy} onClick={() => act("reject")} className="rounded border border-neutral-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-neutral-700">Reject</button>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CopyButton } from "./copy-button";

export function NewKey({ create }: { create: (name: string) => Promise<{ token?: string; error?: string }> }) {
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { const r = await create(name); if (r.error) setErr(r.error); else { setToken(r.token ?? null); setName(""); router.refresh(); } } finally { setBusy(false); }
      }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Key name, e.g. Cursor or Grok API" className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900" />
        <button disabled={busy} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">Create key</button>
      </form>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {token && (
        <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:ring-emerald-900">
          <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Copy this key now. It won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-white px-2 py-1.5 font-mono text-xs dark:bg-neutral-900">{token}</code>
            <CopyButton text={token} />
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "../../ui";

/** Add, test and remove your own Claude API key for the in-app AI assistant. */
export function AiKeyForm({ hint }: { hint: string | null }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (hint) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="chip bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"><Icon name="check" className="h-3 w-3" /> Claude connected · key {hint}</span>
        <button className="btn !py-1.5 !text-xs !text-red-600" disabled={busy} onClick={async () => {
          if (!confirm("Remove your Claude API key from Unified Box?")) return;
          setBusy(true); await fetch("/api/ai/key", { method: "DELETE" }); setBusy(false); router.refresh();
        }}>Remove key</button>
      </div>
    );
  }
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      const r = await fetch("/api/ai/key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) return setMsg({ ok: false, text: j.error ?? "Couldn't save the key" });
      setKey(""); setMsg({ ok: true, text: "Key checked and saved. “Write with AI” is now in every reply box." }); router.refresh();
    }}>
      <div className="flex flex-wrap gap-2">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" aria-label="Claude API key" required className="field min-w-0 flex-1 font-mono" />
        <button disabled={busy || !key.trim()} className="btn-primary">{busy ? "Checking…" : "Save key"}</button>
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>{msg.text}</p>}
    </form>
  );
}

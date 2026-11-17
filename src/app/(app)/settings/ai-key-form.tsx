"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "../../ui";

/** Add, test and remove your own Claude or OpenAI API key for the in-app AI assistant. */
export function AiKeyForm({ hint, provider: current, model }: { hint: string | null; provider?: string; model?: string }) {
  const router = useRouter();
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (hint) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="chip bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"><Icon name="check" className="h-3 w-3" /> {current === "openai" ? "OpenAI" : "Claude"} connected · key {hint}</span>
        {model && <span className="text-xs muted">Model: {model}</span>}
        <button className="btn !py-1.5 !text-xs !text-red-600" disabled={busy} onClick={async () => {
          if (!confirm("Remove your AI API key from Unified Box?")) return;
          setBusy(true); await fetch("/api/ai/key", { method: "DELETE" }); setBusy(false); router.refresh();
        }}>Remove key</button>
      </div>
    );
  }
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      const r = await fetch("/api/ai/key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, provider }) });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) return setMsg({ ok: false, text: j.error ?? "Couldn't save the key" });
      setKey(""); setMsg({ ok: true, text: `Key checked and saved${j.model ? ` (model: ${j.model})` : ""}. “Write with AI” is now in every reply box.` }); router.refresh();
    }}>
      <div role="radiogroup" aria-label="AI provider" className="inline-flex gap-0.5 rounded-lg bg-[var(--surface-2)] p-0.5">
        {([["anthropic", "Claude (Anthropic)"], ["openai", "OpenAI (ChatGPT)"]] as const).map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={provider === v} onClick={() => { setProvider(v); setMsg(null); }}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${provider === v ? "bg-[var(--surface)] shadow-sm" : "muted"}`}>{label}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider === "openai" ? "sk-proj-…" : "sk-ant-…"} autoComplete="off" aria-label={provider === "openai" ? "OpenAI API key" : "Claude API key"} required className="field min-w-0 flex-1 font-mono" />
        <button disabled={busy || !key.trim()} className="btn-primary">{busy ? "Checking…" : "Save key"}</button>
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>{msg.text}</p>}
    </form>
  );
}

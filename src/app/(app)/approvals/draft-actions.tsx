"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DraftActions({ id, subject, body }: { id: string; subject: string; body: string }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sub, setSub] = useState(subject);
  const [text, setText] = useState(body);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function act(action: "approve" | "reject") {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/drafts/${id}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "approve" && editing ? { action, subject: sub, body: text } : { action }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Failed (${res.status})`); return; }
    } finally { setBusy(false); router.refresh(); }
  }

  return (
    <div className="mt-1 space-y-2">
      {!editing && (
        <>
          <div className="font-medium">{sub}</div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{text}</pre>
        </>
      )}
      {editing && (
        <div className="space-y-2">
          <input value={sub} onChange={(e) => setSub(e.target.value)} className="field" aria-label="Subject" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="field leading-relaxed" aria-label="Message" />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => act("approve")} className="btn-primary">{editing ? "Send edited version" : "Send"}</button>
        <button disabled={busy} onClick={() => setEditing((v) => !v)} className="btn">{editing ? "Cancel edit" : "Edit"}</button>
        <button disabled={busy} onClick={() => act("reject")} className="btn !text-red-600">Discard</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}

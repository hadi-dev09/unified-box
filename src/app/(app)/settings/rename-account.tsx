"use client";
import { useState, useTransition } from "react";
import { renameAccountAction } from "../../actions";
import { Icon } from "../../ui";

/** Click the name to rename an account (e.g. "Greenbridge Slack"); empty resets to the address. */
export function RenameAccount({ id, label, fallback }: { id: string; label: string | null; fallback: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(label ?? "");
  const [pending, start] = useTransition();
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="group inline-flex max-w-full items-center gap-1.5 text-left font-semibold" title="Rename">
        <span className="truncate">{label || fallback}</span><Icon name="pencil" className="h-3 w-3 shrink-0 muted opacity-60 group-hover:opacity-100" />
      </button>
    );
  }
  return (
    <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); start(async () => { await renameAccountAction(id, v); setEditing(false); }); }}>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={60} placeholder={fallback} aria-label="Name" className="field !py-1 text-sm"
        onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); setV(label ?? ""); } }} />
      <button disabled={pending} className="btn-primary !px-3 !py-1 !text-xs">Save</button>
      <button type="button" onClick={() => { setEditing(false); setV(label ?? ""); }} className="text-xs muted">Cancel</button>
    </form>
  );
}

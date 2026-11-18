"use client";
import { useRouter } from "next/navigation";
import { useActionState, useRef, useState } from "react";
import { Icon } from "../../ui";
import { changePassword, updateName, type ProfileState } from "./actions";

function Note({ s }: { s: ProfileState }) {
  if (!s) return null;
  return <p role={s.error ? "alert" : "status"} className={`text-sm ${s.error ? "text-red-600" : "text-emerald-700 dark:text-emerald-300"}`}>{s.error ?? s.ok}</p>;
}

export function AvatarEditor({ name, email, url }: { name: string; email: string; url: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState(url);
  const initials = (name || email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="flex flex-wrap items-center gap-4">
      {preview
        ? <img src={preview} alt="Your profile photo" className="h-20 w-20 rounded-2xl object-cover ring-1 ring-[var(--border)]" />
        : <span className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-2xl font-bold text-white">{initials || "?"}</span>}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn"><Icon name="pencil" /> {preview ? "Change photo" : "Upload photo"}</button>
          {preview && <button type="button" disabled={busy} className="btn !text-red-600" onClick={async () => {
            setBusy(true); await fetch("/api/profile/avatar", { method: "DELETE" }); setBusy(false); setPreview(null); router.refresh();
          }}>Remove</button>}
        </div>
        <p className="text-xs muted">PNG, JPG, WebP or GIF, up to 2 MB.</p>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" aria-label="Profile photo" onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        setBusy(true); setErr(null);
        const fd = new FormData(); fd.append("file", f);
        const r = await fetch("/api/profile/avatar", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) return setErr(j.error ?? "Upload failed");
        setPreview(j.url); router.refresh();
      }} />
    </div>
  );
}

export function NameForm({ name }: { name: string }) {
  const [s, action, pending] = useActionState(updateName, undefined);
  return (
    <form action={action} className="space-y-2">
      <label className="block text-sm font-medium" htmlFor="p-name">Name</label>
      <div className="flex gap-2">
        <input id="p-name" name="name" defaultValue={name} maxLength={80} placeholder="Your name" className="field" />
        <button disabled={pending} className="btn-primary shrink-0">{pending ? "Saving…" : "Save"}</button>
      </div>
      <Note s={s} />
    </form>
  );
}

export function PasswordForm() {
  const [s, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="password" type="password" autoComplete="new-password" placeholder="New password" aria-label="New password" required className="field" />
        <input name="confirm" type="password" autoComplete="new-password" placeholder="Repeat new password" aria-label="Repeat new password" required className="field" />
      </div>
      <p className="text-xs muted">At least 8 characters, with a letter and a number.</p>
      <button disabled={pending} className="btn">{pending ? "Saving…" : "Change password"}</button>
      <Note s={s} />
    </form>
  );
}

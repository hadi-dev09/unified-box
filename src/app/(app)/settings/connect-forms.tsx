"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900";
const primary = "rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50 dark:bg-white dark:text-neutral-900";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, j: j as Record<string, string> };
}

/** WhatsApp Business (Cloud API): paste the number's ID and a permanent token from Meta. */
export function WhatsAppForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open) return <button className={primary} onClick={() => setOpen(true)}>Connect WhatsApp</button>;
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setBusy(true); setMsg(null);
      const { ok, j } = await post("/api/connect/whatsapp", { phone_number_id: f.get("pnid"), waba_id: f.get("waba"), token: f.get("token") });
      setBusy(false);
      if (!ok) return setMsg({ ok: false, text: j.error ?? "Could not connect" });
      setMsg({ ok: true, text: `Connected ${j.name}${j.number ? ` (${j.number})` : ""}. New messages will appear in your inbox.` });
      (e.target as HTMLFormElement).reset(); router.refresh();
    }}>
      <label className="block text-xs text-neutral-500">Phone number ID<input name="pnid" inputMode="numeric" required className={field} placeholder="e.g. 106540352242922" autoComplete="off" /></label>
      <label className="block text-xs text-neutral-500">WhatsApp Business Account ID (optional, subscribes the webhook)<input name="waba" inputMode="numeric" className={field} autoComplete="off" /></label>
      <label className="block text-xs text-neutral-500">Permanent access token (System User)<input name="token" type="password" required className={field} autoComplete="off" /></label>
      <p className="text-xs text-neutral-500">Find these in Meta Business → WhatsApp Manager → API Setup. The token is encrypted and never shown again.</p>
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>{msg.text}</p>}
      <div className="flex gap-2"><button disabled={busy} className={primary}>{busy ? "Checking…" : "Connect"}</button><button type="button" className="px-2 text-sm text-neutral-500" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

/** Telegram sign-in: phone number → login code → (two-step password if set). */
export function TelegramForm() {
  const router = useRouter();
  const [step, setStep] = useState<"closed" | "phone" | "code" | "password" | "done">("closed");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState("");
  if (step === "closed") return <button className={primary} onClick={() => setStep("phone")}>Connect Telegram</button>;
  if (step === "done") return <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Connected {done}. Your recent chats are syncing.</p>;
  const label = { phone: "Phone number", code: "Login code (sent to your Telegram app)", password: "Two-step verification password" }[step];
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      const v = String(new FormData(e.currentTarget).get("v") ?? "");
      setBusy(true); setErr(null);
      const body = step === "phone" ? { action: "start", phone: v } : step === "code" ? { action: "code", code: v } : { action: "password", password: v };
      const { ok, j } = await post("/api/connect/telegram", body);
      setBusy(false);
      if (!ok) return setErr(j.error ?? "Sign-in failed");
      (e.target as HTMLFormElement).reset();
      if (j.step === "done") { setDone(j.name ?? ""); setStep("done"); router.refresh(); } else setStep(j.step as "code" | "password");
    }}>
      <label className="block text-xs text-neutral-500">{label}
        <input key={step} name="v" required autoFocus className={field} autoComplete={step === "code" ? "one-time-code" : "off"}
          type={step === "password" ? "password" : step === "phone" ? "tel" : "text"} inputMode={step === "code" ? "numeric" : undefined}
          placeholder={step === "phone" ? "+92 300 1234567" : step === "code" ? "12345" : ""} />
      </label>
      {step === "phone" && <p className="text-xs text-neutral-500">Telegram sends a code to your Telegram app (not SMS). Unified Box keeps an encrypted session; you can end it any time from Telegram → Settings → Devices.</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2"><button disabled={busy} className={primary}>{busy ? "Please wait…" : step === "phone" ? "Send code" : "Continue"}</button><button type="button" className="px-2 text-sm text-neutral-500" onClick={() => { setStep("closed"); setErr(null); }}>Cancel</button></div>
    </form>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const primary = "btn-primary";

/** Link WhatsApp like WhatsApp Web: show a QR code (or a pairing code) and wait until the phone confirms. */
export function WhatsAppQrForm() {
  const router = useRouter();
  const [step, setStep] = useState<"idle" | "starting" | "qr" | "done" | "blocked">("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  useEffect(() => stop, []);

  async function poll() {
    const r = await fetch("/api/connect/whatsapp-web", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { stop(); setStep("idle"); setMsg(j.error ?? "Linking stopped. Try again."); return; }
    if (j.status === "SCAN_QR_CODE") { setStep("qr"); if (j.qr) setQr(j.qr); }
    if (j.status === "PASSKEY_REQUIRED" || j.status === "PASSKEY_CONFIRMATION_REQUIRED") { stop(); setStep("blocked"); setMsg(j.message); }
    if (j.status === "WORKING") { stop(); setStep("done"); setMsg(`Linked ${j.connected}. New messages will appear in your inbox.`); router.refresh(); }
  }
  async function start() {
    setStep("starting"); setMsg(null); setQr(null); setCode(null);
    const r = await fetch("/api/connect/whatsapp-web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setStep("idle"); return setMsg(j.error ?? "Couldn't start"); }
    stop(); timer.current = setInterval(poll, 2500); poll();
  }
  async function cancel() {
    stop(); setStep("idle"); setQr(null); setCode(null);
    await fetch("/api/connect/whatsapp-web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }).catch(() => null);
  }
  async function getCode() {
    const r = await fetch("/api/connect/whatsapp-web", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "code", phone }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(j.error ?? "Couldn't get a code");
    setCode(j.code); setMsg(null);
  }

  if (step === "idle" || step === "done") return (
    <div className="space-y-2">
      {msg && <p role="status" className={`text-sm ${step === "done" ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>{msg}</p>}
      <button className={primary} onClick={start}>{step === "done" ? "Link another number" : "Link with QR code"}</button>
    </div>
  );
  return (
    <div className="space-y-3">
      {step === "starting" && <p className="text-sm muted">Preparing a QR code…</p>}
      {step === "qr" && (
        <>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm muted">
            <li>Open WhatsApp on your phone → <b className="text-[var(--text)]">Settings → Linked devices → Link a device</b></li>
            <li>Point your phone at this code</li>
          </ol>
          <div className="inline-flex rounded-2xl bg-white p-3 ring-1 ring-[var(--border)]">
            {qr ? <img src={qr} alt="WhatsApp QR code" width={220} height={220} /> : <div className="skeleton h-[220px] w-[220px]" />}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer muted">Can&apos;t scan? Link with your phone number instead</summary>
            <div className="mt-2 flex gap-2">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 300 1234567" inputMode="tel" aria-label="WhatsApp number" className="field" />
              <button className="btn shrink-0" onClick={getCode}>Get code</button>
            </div>
            {code && <p className="mt-2">On your phone: Linked devices → Link a device → <b>Link with phone number instead</b>, then enter <span className="font-mono text-lg font-bold tracking-widest">{code}</span></p>}
          </details>
        </>
      )}
      {step === "blocked" && <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">{msg}</p>}
      {msg && step !== "blocked" && <p className="text-sm text-red-600">{msg}</p>}
      <button className="text-sm muted underline-offset-4 hover:underline" onClick={cancel}>Cancel</button>
    </div>
  );
}

const PRESET_OPTS = [["gmail", "Gmail"], ["yahoo", "Yahoo"], ["icloud", "iCloud"], ["zoho", "Zoho"], ["fastmail", "Fastmail"], ["custom", "Other / own domain"]] as const;
const HELP: Record<string, string> = {
  gmail: "Turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords (16 letters).",
  yahoo: "Yahoo account → Account security → Generate app password.",
  icloud: "account.apple.com → Sign-In and Security → App-Specific Passwords.",
  zoho: "Zoho Accounts → Security → App passwords (and enable IMAP in Zoho Mail settings).",
  fastmail: "Fastmail → Settings → Privacy & Security → App passwords (IMAP + SMTP access).",
  custom: "Use the IMAP and SMTP server names from your email provider.",
};

/** Connect any mailbox with an app password (IMAP + SMTP). */
export function ImapForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<string>("gmail");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!open) return <button className={primary} onClick={() => setOpen(true)}>Connect with app password</button>;
  return (
    <form className="space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      setBusy(true); setMsg(null);
      const r = await fetch("/api/connect/imap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        preset, email: f.get("email"), password: f.get("password"), imapHost: f.get("imapHost"), imapPort: f.get("imapPort"), smtpHost: f.get("smtpHost"), smtpPort: f.get("smtpPort"),
      }) });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) return setMsg({ ok: false, text: j.error ?? "Couldn't connect" });
      setMsg({ ok: true, text: `Connected ${j.email}. Your inbox is syncing.` }); (e.target as HTMLFormElement).reset(); router.refresh();
    }}>
      <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Email provider" className="field">
        {PRESET_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <p className="text-xs muted">{HELP[preset]}</p>
      <input name="email" type="email" required placeholder="you@example.com" aria-label="Email address" autoComplete="off" className="field" />
      <input name="password" type="password" required placeholder="App password" aria-label="App password" autoComplete="off" className="field font-mono" />
      {preset === "custom" && (
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <input name="imapHost" placeholder="imap.example.com" aria-label="IMAP server" className="field" required />
          <input name="imapPort" placeholder="993" defaultValue="993" aria-label="IMAP port" className="field" />
          <input name="smtpHost" placeholder="smtp.example.com" aria-label="SMTP server" className="field" required />
          <input name="smtpPort" placeholder="465" defaultValue="465" aria-label="SMTP port" className="field" />
        </div>
      )}
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}`}>{msg.text}</p>}
      <div className="flex gap-2"><button disabled={busy} className={primary}>{busy ? "Checking…" : "Connect"}</button><button type="button" className="px-2 text-sm muted" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

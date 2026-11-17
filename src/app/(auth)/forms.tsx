"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  forgotPassword, resendCode, sendLoginCode, signInWithPassword, signUp, updatePassword, verifyCode, type FormState,
} from "./actions";

const input = "field !rounded-xl !px-3.5 !py-2.5 !text-[15px]";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-sm font-medium">{label}{hint}</span>
      {children}
    </label>
  );
}

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="btn-primary w-full !rounded-xl !py-2.5 !text-[15px]">
      {pending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

function Message({ state }: { state: FormState }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">{state.ok}</p>;
  return null;
}

function PasswordInput({ name, autoComplete, placeholder }: { name: string; autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input name={name} type={show ? "text" : "password"} required minLength={8} maxLength={72} autoComplete={autoComplete} placeholder={placeholder} className={`${input} pr-16`} />
      <button type="button" onClick={() => setShow((v) => !v)} className="absolute inset-y-0 right-2 my-auto h-7 rounded-lg px-2 text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">{show ? "Hide" : "Show"}</button>
    </div>
  );
}

function EmailInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input name="email" type="email" required autoComplete="email" value={value} onChange={(e) => onChange(e.target.value)} placeholder="you@company.com" className={input} />;
}

export function LoginForm({ next, initialEmail = "" }: { next: string; initialEmail?: string }) {
  const [mode, setMode] = useState<"password" | "code">("password");
  const [email, setEmail] = useState(initialEmail);
  const [pwState, pwAction] = useActionState(signInWithPassword, undefined);
  const [codeState, codeAction] = useActionState(sendLoginCode, undefined);
  const tab = (m: typeof mode, label: string) => (
    <button type="button" onClick={() => setMode(m)} className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${mode === m ? "bg-[var(--surface)] shadow-sm" : "muted hover:text-[var(--text)]"}`}>{label}</button>
  );
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-[var(--surface-2)] p-1">{tab("password", "Password")}{tab("code", "Email link")}</div>
      {mode === "password" ? (
        <form action={pwAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <Field label="Email"><EmailInput value={email} onChange={setEmail} /></Field>
          <Field label="Password" hint={<Link href={`/forgot-password`} className="text-xs font-normal text-neutral-500 hover:text-neutral-900 dark:hover:text-white">Forgot password?</Link>}>
            <PasswordInput name="password" autoComplete="current-password" />
          </Field>
          <Message state={pwState} />
          <Submit>Sign in</Submit>
        </form>
      ) : (
        <form action={codeAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <Field label="Email"><EmailInput value={email} onChange={setEmail} /></Field>
          <p className="text-xs text-neutral-500">We&apos;ll email you a one-time sign-in link. No password needed.</p>
          <Message state={codeState} />
          <Submit>Email me a sign-in link</Submit>
        </form>
      )}
    </div>
  );
}

export function SignupForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUp, undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Full name"><input name="name" autoComplete="name" maxLength={80} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className={input} /></Field>
      <Field label="Email"><EmailInput value={email} onChange={setEmail} /></Field>
      <Field label="Password"><PasswordInput name="password" autoComplete="new-password" placeholder="8+ characters, letters and numbers" /></Field>
      <Field label="Confirm password"><PasswordInput name="confirm" autoComplete="new-password" /></Field>
      <label className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <input type="checkbox" name="terms" required className="mt-0.5 h-4 w-4 rounded border-neutral-300" />
        <span>I agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</span>
      </label>
      <Message state={state} />
      <Submit>Create account</Submit>
    </form>
  );
}

export function VerifyForm({ email, type, next }: { email: string; type: string; next: string }) {
  const [state, action] = useActionState(verifyCode, undefined);
  const [rState, rAction] = useActionState(resendCode, undefined);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <Field label="6-digit code (only if your email shows one)">
          <input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" maxLength={12} placeholder="123456" autoFocus
            className={`${input} text-center font-mono text-2xl tracking-[0.5em]`} />
        </Field>
        <Message state={state} />
        <Submit>Verify</Submit>
      </form>
      <form action={rAction} className="text-center">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next} />
        <ResendButton />
        <div className="mt-2"><Message state={rState} /></div>
      </form>
    </div>
  );
}

function ResendButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending} className="text-sm text-neutral-600 underline-offset-4 hover:underline disabled:opacity-50 dark:text-neutral-400">{pending ? "Sending…" : "Didn't get it? Send again"}</button>;
}

export function ForgotForm({ initialEmail = "" }: { initialEmail?: string }) {
  const [state, action] = useActionState(forgotPassword, undefined);
  const [email, setEmail] = useState(initialEmail);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email"><EmailInput value={email} onChange={setEmail} /></Field>
      <Message state={state} />
      <Submit>Send reset link</Submit>
    </form>
  );
}

export function ResetForm() {
  const [state, action] = useActionState(updatePassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="New password"><PasswordInput name="password" autoComplete="new-password" placeholder="8+ characters, letters and numbers" /></Field>
      <Field label="Confirm new password"><PasswordInput name="confirm" autoComplete="new-password" /></Field>
      <Message state={state} />
      <Submit>Save new password</Submit>
    </form>
  );
}

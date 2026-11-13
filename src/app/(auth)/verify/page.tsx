import Link from "next/link";
import { safeNext } from "@/lib/safe-next";
import { VerifyForm } from "../forms";
import { validEmail } from "../auth-logic";

export const metadata = { title: "Check your email · Unified Box" };

const COPY: Record<string, { title: string; body: string }> = {
  signup: { title: "Confirm your email", body: "We sent a confirmation email to" },
  email: { title: "Check your email", body: "If an account exists, we sent a sign-in email to" },
  recovery: { title: "Reset your password", body: "If an account exists, we sent a password-reset email to" },
};

export default async function Verify({ searchParams }: { searchParams: Promise<{ email?: string; type?: string; next?: string }> }) {
  const sp = await searchParams;
  const email = (sp.email ?? "").slice(0, 254);
  const type = sp.type && COPY[sp.type] ? sp.type : "email";
  if (!validEmail(email)) {
    return <p className="text-sm">This page needs an email address. <Link href="/login" className="underline">Back to sign in</Link></p>;
  }
  return (
    <>
      <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-2xl dark:bg-neutral-800">✉️</div>
      <h1 className="text-2xl font-semibold tracking-tight">{COPY[type].title}</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-500">{COPY[type].body} <b className="text-neutral-800 dark:text-neutral-200">{email}</b>. Tap the link in it <b className="text-neutral-800 dark:text-neutral-200">on this device, in this browser</b>. If the email shows a code instead, enter it below.</p>
      <VerifyForm email={email} type={type} next={safeNext(sp.next)} />
      <p className="mt-6 text-center text-sm text-neutral-500"><Link href="/login" className="underline-offset-4 hover:underline">Use a different email</Link></p>
    </>
  );
}

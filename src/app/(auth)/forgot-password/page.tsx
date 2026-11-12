import Link from "next/link";
import { ForgotForm } from "../forms";

export const metadata = { title: "Forgot password · Unified Box" };

export default function Forgot() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-500">Enter your email and we&apos;ll send you a code to choose a new one.</p>
      <ForgotForm />
      <p className="mt-6 text-center text-sm text-neutral-500"><Link href="/login" className="underline-offset-4 hover:underline">Back to sign in</Link></p>
    </>
  );
}

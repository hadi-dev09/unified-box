import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { ResetForm } from "../forms";

export const metadata = { title: "Choose a new password · Unified Box" };

export default async function Reset() {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Link expired</h1>
        <p className="mb-6 mt-1 text-sm text-neutral-500">Your reset session has ended. Request a new code.</p>
        <Link href="/forgot-password" className="inline-flex w-full justify-center rounded-xl bg-neutral-900 px-4 py-2.5 font-semibold text-white dark:bg-white dark:text-neutral-900">Request new code</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-500">For {user.email}</p>
      <ResetForm />
    </>
  );
}

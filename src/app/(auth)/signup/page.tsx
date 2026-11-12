import Link from "next/link";
import { redirect } from "next/navigation";
import { enabledProviders } from "@/lib/auth-providers";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";
import { SignupForm } from "../forms";
import { SocialButtons } from "../social";

export const metadata = { title: "Create account · Unified Box" };

export default async function Signup({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (user) redirect(next);
  const providers = await enabledProviders();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-500">Free while in beta. Connect your first inbox in under a minute.</p>
      <SocialButtons next={next} {...providers} />
      <SignupForm next={next} />
      <p className="mt-6 text-center text-sm text-neutral-500">Already have an account? <Link href="/login" className="font-medium text-neutral-900 underline-offset-4 hover:underline dark:text-white">Sign in</Link></p>
    </>
  );
}

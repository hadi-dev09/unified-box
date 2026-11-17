import Link from "next/link";
import { redirect } from "next/navigation";
import { enabledProviders } from "@/lib/auth-providers";
import { safeNext } from "@/lib/safe-next";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "../forms";
import { SocialButtons } from "../social";

export const metadata = { title: "Sign in · Unified Box" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await currentUser()) redirect(next);
  const providers = await enabledProviders();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-6 mt-1 text-sm muted">Sign in to your inboxes.</p>
      {sp.error && <p role="alert" className="mb-4 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{sp.error.slice(0, 200)}</p>}
      <SocialButtons next={next} slack={providers.slack} />
      <LoginForm next={next} initialEmail={sp.email?.slice(0, 254)} />
      <p className="mt-6 text-center text-sm muted">New to Unified Box? <Link href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-[var(--text)] underline-offset-4 hover:underline">Create an account</Link></p>
    </>
  );
}

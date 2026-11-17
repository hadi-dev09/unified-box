import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { enabledProviders } from "@/lib/auth-providers";
import { safeNext } from "@/lib/safe-next";
import { SignupForm } from "../forms";
import { SocialButtons } from "../social";

export const metadata = { title: "Create account · Unified Box" };

export default async function Signup({ searchParams }: { searchParams: Promise<{ next?: string; with?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await currentUser()) redirect(next);
  const providers = await enabledProviders();
  const emailMode = sp.with === "email";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mb-6 mt-1 text-sm muted">Free while in beta. Every client conversation in one inbox.</p>
      {!emailMode ? (
        <div className="space-y-3">
          <SocialButtons next={next} slack={providers.slack} label="Continue with Google" divider={false} />
          <p className="-mt-1 px-1 text-xs muted">Creates your account and connects that Gmail inbox in one step.</p>
          <Link href={`/signup?with=email${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`} className="btn w-full !rounded-xl !py-2.5 !text-[15px]">Continue with email</Link>
        </div>
      ) : (
        <>
          <SignupForm next={next} />
          <p className="mt-4 text-center text-sm"><Link href={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} className="muted underline-offset-4 hover:underline">← Other sign-up options</Link></p>
        </>
      )}
      <p className="mt-6 text-center text-sm muted">Already have an account? <Link href="/login" className="font-semibold text-[var(--text)] underline-offset-4 hover:underline">Sign in</Link></p>
    </>
  );
}

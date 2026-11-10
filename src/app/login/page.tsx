import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";

async function sendLink(form: FormData) {
  "use server";
  const email = String(form.get("email") ?? "").trim();
  if (!email) return;
  const sb = await supabaseServer();
  await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${env("APP_URL")}/auth/callback` } });
  redirect("/login?sent=1");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">Unified Box</h1>
      <p className="text-sm text-neutral-500">Sign in with a magic link sent to your email.</p>
      <form action={sendLink} className="flex flex-col gap-3">
        <input name="email" type="email" required placeholder="you@example.com" className="rounded-lg border border-neutral-300 bg-transparent px-3 py-3 dark:border-neutral-700" />
        <button className="rounded-lg bg-neutral-900 px-3 py-3 font-medium text-white dark:bg-white dark:text-neutral-900">Email me a link</button>
      </form>
      {sent && <p className="text-sm text-green-600">Check your email for the sign-in link.</p>}
    </main>
  );
}

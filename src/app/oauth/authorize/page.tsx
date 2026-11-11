import { redirect } from "next/navigation";
import { randomToken, getClient, sha256, validRedirectUri } from "@/lib/oauth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

type Q = Record<string, string | undefined>;

/** Validates the authorization request. Never redirects to an unregistered redirect_uri. */
async function check(q: Q) {
  if (q.response_type !== "code") return { error: "Unsupported response_type." };
  if (!q.client_id || !q.redirect_uri || !q.code_challenge) return { error: "Missing required parameters." };
  if (q.code_challenge_method !== "S256") return { error: "PKCE with S256 is required." };
  const client = await getClient(q.client_id);
  if (!client) return { error: "Unknown application." };
  if (!client.redirect_uris.includes(q.redirect_uri) || !validRedirectUri(q.redirect_uri)) return { error: "Redirect URI does not match this application's registration." };
  return { client };
}

async function decide(form: FormData) {
  "use server";
  const q = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) as Q;
  const v = await check(q);
  if ("error" in v) redirect(`/oauth/authorize?error=${encodeURIComponent(v.error ?? "error")}`);

  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) redirect("/login");

  const dest = new URL(q.redirect_uri!);
  if (q.state) dest.searchParams.set("state", q.state);

  if (q.decision !== "approve") {
    dest.searchParams.set("error", "access_denied");
    redirect(dest.toString());
  }

  const code = randomToken();
  const db = supabaseAdmin();
  await db.from("oauth_codes").insert({
    code_hash: sha256(code), client_id: q.client_id, user_id: user.id, redirect_uri: q.redirect_uri,
    code_challenge: q.code_challenge, resource: q.resource ?? null, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "oauth.approved", target: v.client!.client_name, meta: { client_id: q.client_id } });
  dest.searchParams.set("code", code);
  redirect(dest.toString());
}

export default async function Authorize({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  if (q.error) return <Shell><p className="text-red-600">{q.error}</p></Shell>;

  const v = await check(q);
  if ("error" in v) return <Shell><p className="text-red-600">{v.error}</p></Shell>;

  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) {
    const back = `/oauth/authorize?${new URLSearchParams(Object.entries(q).filter(([, x]) => x !== undefined) as [string, string][])}`;
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }

  const host = new URL(q.redirect_uri!).host;
  const hidden = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource"] as const;
  return (
    <Shell>
      <h1 className="text-xl font-semibold">Connect {v.client!.client_name}</h1>
      <p className="text-sm text-neutral-500">Signed in as {user.email}. Callback: {host}</p>
      <div className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
        <p className="mb-2 font-medium">This app will be able to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Read your connected inboxes, threads and messages</li>
          <li>Search across them and build digests</li>
          <li>Create <b>draft</b> replies that wait for your approval</li>
        </ul>
        <p className="mt-3 font-medium">It cannot:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Send any message (only you can approve and send)</li>
          <li>Delete anything</li>
        </ul>
      </div>
      <form action={decide} className="flex gap-2">
        {hidden.map((k) => q[k] !== undefined && <input key={k} type="hidden" name={k} value={q[k]} />)}
        <button name="decision" value="approve" className="flex-1 rounded-lg bg-green-600 px-4 py-3 font-medium text-white">Approve</button>
        <button name="decision" value="deny" className="flex-1 rounded-lg border border-neutral-300 px-4 py-3 dark:border-neutral-700">Cancel</button>
      </form>
      <p className="text-xs text-neutral-500">You can revoke access any time in Connect accounts → Connected apps.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">{children}</main>;
}

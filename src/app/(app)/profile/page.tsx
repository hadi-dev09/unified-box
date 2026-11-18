import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { PageFrame } from "../../shell";
import { accountName, channel, ChannelAvatar, Icon } from "../../ui";
import { AvatarEditor, NameForm, PasswordForm } from "./profile-forms";

export const metadata = { title: "Profile · Unified Box" };

/** Who you're signed in as, and your profile: name, photo, password, sign out. */
export default async function Profile() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/profile");
  const sb = await supabaseServer();
  const { data: accts } = await sb.from("accounts").select("id, provider, display_name, label, status").order("provider");
  const accounts = (accts ?? []) as { id: string; provider: string; display_name: string; label: string | null; status: string }[];
  const via = user.provider === "google" ? "Google" : user.provider === "slack_oidc" ? "Slack" : "email";
  return (
    <PageFrame title="Profile">
      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-6 md:px-6">
        <section className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider muted">Signed in as</p>
          <p className="mt-1 break-all text-lg font-semibold">{user.email}</p>
          <p className="text-sm muted">Unified Box account · signs in with {via === "email" ? "email (password, link or Google)" : via}</p>
          <div className="mt-5 border-t border-[var(--border)] pt-5"><AvatarEditor name={user.name} email={user.email} url={user.avatarUrl} /></div>
          <div className="mt-5"><NameForm name={user.name} /></div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold">Password</h2>
          <p className="mb-3 mt-1 text-sm muted">If you signed up with Google you can still set a password, so you can also sign in with email.</p>
          <PasswordForm />
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Connected channels</h2><Link href="/settings" className="text-sm font-medium text-[var(--accent-text)] hover:underline">Manage</Link></div>
          <p className="mb-3 mt-1 text-sm muted">These are the inboxes inside your account. They can be different from the email you sign in with.</p>
          <ul className="space-y-2">
            {accounts.length === 0 && <li className="text-sm muted">None yet.</li>}
            {accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-xl bg-[var(--surface-2)] px-3 py-2">
                <ChannelAvatar provider={a.provider} name={accountName(a)} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{accountName(a)}{a.label && <span className="ml-1.5 font-normal muted">{a.display_name}</span>}</span>
                <span className="text-xs muted">{channel(a.provider).name}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div><h2 className="font-semibold">Sign out</h2><p className="text-sm muted">Signs you out of Unified Box on this device. Your connected inboxes stay connected.</p></div>
          <form action="/auth/signout" method="post"><button className="btn"><Icon name="logout" /> Sign out</button></form>
        </section>
      </main>
    </PageFrame>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { msg } = await searchParams;
  const { data: accounts } = await sb.from("accounts").select("id, display_name, account_type, status, status_detail, can_send");
  const btn = "rounded-lg border border-neutral-300 px-3 py-3 text-sm dark:border-neutral-700";
  return (
    <main className="mx-auto max-w-xl p-4">
      <Link href="/" className="text-sm text-blue-600">← Inbox</Link>
      <h1 className="my-3 text-xl font-semibold">Connect accounts</h1>
      {msg && <p className="mb-3 rounded bg-neutral-100 p-3 text-sm dark:bg-neutral-900">{msg}</p>}
      <h2 className="mt-4 font-medium">Gmail</h2>
      <p className="mb-2 text-sm text-neutral-500">Read-only by default. Enable sending only if you want to approve and send replies from here.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <a className={btn} href="/api/connect/gmail?type=personal">Personal · read-only</a>
        <a className={btn} href="/api/connect/gmail?type=company">Company · read-only</a>
        <a className={btn} href="/api/connect/gmail?type=personal&write=1">Personal · read + send</a>
        <a className={btn} href="/api/connect/gmail?type=company&write=1">Company · read + send</a>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Company accounts may be blocked by a Workspace admin; you'll see a clear message if so. Slack, WhatsApp, Upwork and Telegram are coming next.</p>
      <h2 className="mt-6 font-medium">Connected</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {(accounts ?? []).map((a) => (
          <li key={a.id} className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
            {a.display_name} · {a.account_type} · {a.status}{a.can_send ? " · can send" : " · read-only"}
            {a.status_detail && <div className="text-xs text-red-600">{a.status_detail}</div>}
          </li>
        ))}
      </ul>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { SyncButton } from "./sync-button";

type Account = { id: string; display_name: string; account_type: string; status: string; status_detail: string | null };

const badge: Record<string, string> = {
  connected: "bg-green-500", needs_reauth: "bg-amber-500", blocked_by_admin: "bg-red-500", error: "bg-red-500",
};

export default async function Home({ searchParams }: { searchParams: Promise<{ account?: string; thread?: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { account, thread } = await searchParams;

  const [{ data: accounts }, { count: pending }] = await Promise.all([
    sb.from("accounts").select("id, display_name, account_type, status, status_detail").order("display_name"),
    sb.from("drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  let tq = sb.from("threads").select("id, subject, snippet, last_message_at, unread, needs_reply, accounts(display_name)").order("last_message_at", { ascending: false }).limit(100);
  if (account) tq = tq.eq("account_id", account);
  const { data: threads } = await tq;

  const { data: messages } = thread
    ? await sb.from("messages").select("id, from_name, from_addr, sent_at, is_outgoing, body_text").eq("thread_id", thread).order("sent_at")
    : { data: null };

  const list = (accounts ?? []) as Account[];
  const hasThread = Boolean(thread);

  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[260px_340px_1fr]">
      {/* Sidebar: hidden on mobile while reading a thread */}
      <aside className={`${hasThread ? "hidden md:block" : "block"} border-r border-neutral-200 p-3 dark:border-neutral-800 ${account ? "hidden md:block" : ""}`}>
        <div className="mb-3 flex items-center justify-between"><h1 className="font-semibold">Unified Box</h1><SyncButton /></div>
        <nav className="flex flex-col gap-1 text-sm">
          <Link href="/" className="rounded px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-900">All inboxes</Link>
          {list.map((a) => (
            <Link key={a.id} href={`/?account=${a.id}`} className={`flex items-center gap-2 rounded px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-900 ${account === a.id ? "bg-neutral-100 dark:bg-neutral-900" : ""}`}>
              <span className={`h-2 w-2 rounded-full ${badge[a.status] ?? "bg-neutral-400"}`} title={a.status_detail ?? a.status} />
              <span className="truncate">{a.display_name}</span>
              <span className="ml-auto text-xs text-neutral-500">{a.account_type}</span>
            </Link>
          ))}
          <Link href="/approvals" className="mt-3 rounded px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-900">Approvals{pending ? ` (${pending})` : ""}</Link>
          <Link href="/settings" className="rounded px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-900">Connect accounts</Link>
        </nav>
        {list.some((a) => a.status !== "connected") && <p className="mt-3 text-xs text-amber-600">Some inboxes need attention (red/amber dot).</p>}
      </aside>

      <section className={`${hasThread ? "hidden md:block" : "block"} overflow-y-auto border-r border-neutral-200 dark:border-neutral-800`}>
        {(threads ?? []).length === 0 && <p className="p-4 text-sm text-neutral-500">No messages yet. Connect an account in “Connect accounts”.</p>}
        {(threads ?? []).map((t) => {
          const acct = (t.accounts as unknown as { display_name: string } | null)?.display_name;
          return (
            <Link key={t.id} href={`/?${account ? `account=${account}&` : ""}thread=${t.id}`} className={`block border-b border-neutral-100 px-3 py-3 dark:border-neutral-900 ${thread === t.id ? "bg-neutral-100 dark:bg-neutral-900" : ""}`}>
              <div className="flex items-center gap-2"><span className={`truncate text-sm ${t.unread ? "font-semibold" : ""}`}>{t.subject || "(no subject)"}</span>{t.needs_reply && <span className="ml-auto rounded bg-amber-100 px-1.5 text-[10px] text-amber-800">reply</span>}</div>
              <div className="truncate text-xs text-neutral-500">{acct} · {t.snippet}</div>
            </Link>
          );
        })}
      </section>

      <main className={`${hasThread ? "block" : "hidden md:block"} overflow-y-auto p-4`}>
        {hasThread && <Link href={account ? `/?account=${account}` : "/"} className="mb-3 inline-block text-sm text-blue-600 md:hidden">← Back</Link>}
        {!messages ? <p className="text-sm text-neutral-500">Select a conversation.</p> : messages.map((m) => (
          <article key={m.id} className="mb-4 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <header className="mb-2 text-xs text-neutral-500">{m.is_outgoing ? "You" : m.from_name || m.from_addr} · {new Date(m.sent_at).toLocaleString()}</header>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">{m.body_text}</pre>
          </article>
        ))}
      </main>
    </div>
  );
}

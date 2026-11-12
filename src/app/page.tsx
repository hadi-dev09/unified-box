import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { setThreadClient } from "@/lib/clients";
import { supabaseServer } from "@/lib/supabase/server";
import { LocalTime } from "./local-time";
import { AutoSync } from "./auto-sync";
import { SyncButton } from "./sync-button";

type Account = { id: string; provider?: string; display_name: string; account_type: string; status: string; status_detail: string | null; last_synced_at: string | null };
type Filter = "all" | "unread" | "reply";

const dot: Record<string, string> = {
  connected: "bg-emerald-500", needs_reauth: "bg-amber-500", blocked_by_admin: "bg-red-500", error: "bg-red-500",
};
const statusText: Record<string, string> = {
  needs_reauth: "Needs reconnect", blocked_by_admin: "Blocked by admin", error: "Sync error",
};

async function assignClient(form: FormData) {
  "use server";
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return;
  const client = String(form.get("client") ?? "");
  await setThreadClient(user.id, String(form.get("thread") ?? ""), client || null);
  revalidatePath("/");
}

export default async function Home({ searchParams }: { searchParams: Promise<{ account?: string; client?: string; thread?: string; f?: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { account, client, thread } = await searchParams;
  const f = (await searchParams).f;
  const filter: Filter = f === "unread" || f === "reply" ? f : "all";

  const [{ data: accounts }, { count: pending }, { data: counts }, { data: clientRows }] = await Promise.all([
    sb.from("accounts").select("id, provider, display_name, account_type, status, status_detail, last_synced_at").order("display_name"),
    sb.from("drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("threads").select("account_id, client_id, unread, needs_reply").order("last_message_at", { ascending: false }).limit(2000),
    sb.from("clients").select("id, name").order("name"),
  ]);
  const clients = (clientRows ?? []) as { id: string; name: string }[];

  const per: Record<string, { unread: number; reply: number }> = {};
  const perClient: Record<string, number> = {};
  let totalUnread = 0, totalReply = 0;
  for (const c of counts ?? []) {
    per[c.account_id] ??= { unread: 0, reply: 0 };
    if (c.unread) { per[c.account_id].unread++; totalUnread++; if (c.client_id) perClient[c.client_id] = (perClient[c.client_id] ?? 0) + 1; }
    if (c.needs_reply) { per[c.account_id].reply++; totalReply++; }
  }

  let tq = sb.from("threads").select("id, subject, snippet, last_message_at, unread, needs_reply, last_from, accounts(display_name), clients(name)").order("last_message_at", { ascending: false }).limit(100);
  if (account) tq = tq.eq("account_id", account);
  if (client) tq = tq.eq("client_id", client);
  if (filter === "unread") tq = tq.eq("unread", true);
  if (filter === "reply") tq = tq.eq("needs_reply", true);
  const { data: threads } = await tq;

  const [{ data: messages }, { data: current }] = thread
    ? await Promise.all([
        sb.from("messages").select("id, from_name, from_addr, to_addrs, sent_at, is_outgoing, body_text").eq("thread_id", thread).order("sent_at"),
        sb.from("threads").select("subject, client_id, accounts(display_name)").eq("id", thread).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  const list = (accounts ?? []) as Account[];
  const lastSynced = list.map((a) => a.last_synced_at).filter(Boolean).sort().pop() ?? null;
  const hasThread = Boolean(thread);
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ account, client, f: filter === "all" ? undefined : filter, ...o }).filter(([, v]) => v) as [string, string][]);
    return p.size ? `/?${p}` : "/";
  };
  const ring = "hover:bg-neutral-100 dark:hover:bg-neutral-900";

  return (
    <div className="grid h-dvh grid-cols-1 md:grid-cols-[260px_360px_1fr]">
      <AutoSync enabled={list.some((a) => a.status === "connected" || a.status === "error")} lastSyncedAt={lastSynced} />
      {/* Sidebar */}
      <aside className="hidden flex-col gap-3 overflow-y-auto border-r border-neutral-200 p-3 dark:border-neutral-800 md:flex">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold">Unified Box</h1>
          <SyncButton />
        </div>
        <nav className="flex flex-col gap-0.5 text-sm">
          <Link href="/" className={`flex items-center justify-between rounded-md px-2 py-2 ${!account && !client ? "bg-neutral-100 dark:bg-neutral-900" : ""} ${ring}`}>
            <span>All inboxes</span>
            {totalUnread > 0 && <span className="text-xs font-medium text-blue-600">{totalUnread}</span>}
          </Link>
          <p className="mt-3 px-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Inboxes</p>
          {list.length === 0 && <p className="px-2 py-1 text-xs text-neutral-500">No accounts yet.</p>}
          {list.map((a) => (
            <Link key={a.id} href={`/?account=${a.id}`} title={a.status_detail ?? a.status}
              className={`flex items-center gap-2 rounded-md px-2 py-2 ${account === a.id ? "bg-neutral-100 dark:bg-neutral-900" : ""} ${ring}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot[a.status] ?? "bg-neutral-400"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.display_name}</span>
                <span className="block text-[11px] text-neutral-500">{a.provider === "slack" ? "Slack" : a.account_type}{statusText[a.status] ? ` · ${statusText[a.status]}` : ""}</span>
              </span>
              {(per[a.id]?.unread ?? 0) > 0 && <span className="text-xs font-medium text-blue-600">{per[a.id].unread}</span>}
            </Link>
          ))}
        </nav>
        {clients.length > 0 && (
          <nav className="flex flex-col gap-0.5 text-sm">
            <p className="mt-1 px-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Clients</p>
            {clients.map((c) => (
              <Link key={c.id} href={`/?client=${c.id}`} className={`flex items-center justify-between rounded-md px-2 py-2 ${client === c.id ? "bg-neutral-100 dark:bg-neutral-900" : ""} ${ring}`}>
                <span className="truncate">{c.name}</span>
                {(perClient[c.id] ?? 0) > 0 && <span className="text-xs font-medium text-blue-600">{perClient[c.id]}</span>}
              </Link>
            ))}
          </nav>
        )}
        <nav className="mt-auto flex flex-col gap-0.5 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
          <Link href="/approvals" className={`flex items-center justify-between rounded-md px-2 py-2 ${ring}`}>
            <span>Approvals</span>
            {pending ? <span className="rounded-full bg-amber-500 px-2 text-xs font-medium text-white">{pending}</span> : null}
          </Link>
          <Link href="/settings" className={`rounded-md px-2 py-2 ${ring}`}>Connect accounts</Link>
        </nav>
        {list.some((a) => a.status !== "connected") && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">Some inboxes need attention. Open Connect accounts.</p>}
      </aside>

      {/* Thread list */}
      <section className={`${hasThread ? "hidden md:flex" : "flex"} min-h-0 flex-col border-r border-neutral-200 dark:border-neutral-800`}>
        <div className="border-b border-neutral-200 md:hidden dark:border-neutral-800">
          <div className="flex items-center justify-between gap-2 px-3 pt-3">
            <h1 className="text-base font-semibold">Unified Box</h1>
            <div className="flex items-center gap-2 text-sm">
              <Link href="/approvals" className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">Approvals{pending ? ` (${pending})` : ""}</Link>
              <Link href="/settings" className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">Accounts</Link>
              <SyncButton />
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto px-3 py-2 text-sm [scrollbar-width:none]">
            <Link href={qs({ account: undefined, client: undefined, thread: undefined })} className={`shrink-0 rounded-full border px-3 py-1 ${!account && !client ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 dark:border-neutral-700"}`}>All{totalUnread ? ` · ${totalUnread}` : ""}</Link>
            {list.map((a) => (
              <Link key={a.id} href={qs({ account: a.id, thread: undefined })} className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 ${account === a.id ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-neutral-300 dark:border-neutral-700"}`}>
                <span className={`h-2 w-2 rounded-full ${dot[a.status] ?? "bg-neutral-400"}`} />
                {a.display_name.split("@")[0]}{(per[a.id]?.unread ?? 0) > 0 ? ` · ${per[a.id].unread}` : ""}
              </Link>
            ))}
            {clients.map((c) => (
              <Link key={c.id} href={qs({ account: undefined, client: c.id, thread: undefined })} className={`shrink-0 rounded-full border px-3 py-1 ${client === c.id ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900" : "border-dashed border-neutral-400 dark:border-neutral-600"}`}>
                {c.name}{(perClient[c.id] ?? 0) > 0 ? ` · ${perClient[c.id]}` : ""}
              </Link>
            ))}
          </div>
          {list.some((a) => a.status !== "connected") && <p className="mx-3 mb-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">Some inboxes need attention. Tap Accounts.</p>}
        </div>
        <div className="flex gap-1 border-b border-neutral-200 p-2 text-sm dark:border-neutral-800">
          {([["all", "All"], ["unread", `Unread${totalUnread ? ` (${totalUnread})` : ""}`], ["reply", `Needs reply${totalReply ? ` (${totalReply})` : ""}`]] as const).map(([k, label]) => (
            <Link key={k} href={qs({ f: k === "all" ? undefined : k, thread: undefined })}
              className={`rounded-full px-3 py-1 ${filter === k ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : `text-neutral-600 dark:text-neutral-400 ${ring}`}`}>{label}</Link>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {(threads ?? []).length === 0 && (
            <p className="p-4 text-sm text-neutral-500">{filter === "all" ? "No messages yet. Connect an account, then press Sync." : "Nothing here. You're all caught up."}</p>
          )}
          {(threads ?? []).map((t) => {
            const acct = (t.accounts as unknown as { display_name: string } | null)?.display_name;
            return (
              <Link key={t.id} href={qs({ thread: t.id })}
                className={`flex gap-2 border-b border-neutral-100 px-3 py-3 dark:border-neutral-900 ${thread === t.id ? "bg-neutral-100 dark:bg-neutral-900" : ring}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.unread ? "bg-blue-600" : "bg-transparent"}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`min-w-0 flex-1 truncate text-sm ${t.unread ? "font-semibold" : ""}`}>{t.last_from || "(unknown)"}</span>
                    <span className="shrink-0 text-xs text-neutral-500"><LocalTime iso={t.last_message_at} /></span>
                  </span>
                  <span className={`block truncate text-sm ${t.unread ? "" : "text-neutral-700 dark:text-neutral-300"}`}>{t.subject || "(no subject)"}</span>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">{t.snippet}</span>
                    {t.needs_reply && <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-100">reply</span>}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                    {!account && acct && <span className="truncate">{acct}</span>}
                    {(t.clients as unknown as { name: string } | null)?.name && <span className="shrink-0 rounded bg-violet-100 px-1.5 text-violet-800 dark:bg-violet-950 dark:text-violet-200">{(t.clients as unknown as { name: string }).name}</span>}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Conversation */}
      <main className={`${hasThread ? "flex" : "hidden md:flex"} min-h-0 flex-col`}>
        {!messages ? (
          <div className="m-auto text-sm text-neutral-500">Select a conversation</div>
        ) : (
          <>
            <header className="border-b border-neutral-200 p-3 dark:border-neutral-800">
              <Link href={qs({ thread: undefined })} className="mb-1 inline-block text-sm text-blue-600 md:hidden">← Back</Link>
              <h2 className="text-lg font-semibold leading-snug">{current?.subject || "(no subject)"}</h2>
              <p className="text-xs text-neutral-500">{(current?.accounts as unknown as { display_name: string } | null)?.display_name} · {messages.length} message{messages.length === 1 ? "" : "s"}</p>
              {clients.length > 0 && (
                <form action={assignClient} className="mt-2 flex items-center gap-2 text-xs">
                  <input type="hidden" name="thread" value={thread} />
                  <label className="text-neutral-500" htmlFor="client">Client</label>
                  <select id="client" name="client" defaultValue={(current as { client_id?: string | null } | null)?.client_id ?? ""} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700">
                    <option value="">None</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700">Save</button>
                </form>
              )}
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {messages.map((m) => (
                <article key={m.id} className={`rounded-xl border p-3 ${m.is_outgoing ? "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40" : "border-neutral-200 dark:border-neutral-800"}`}>
                  <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-neutral-500">
                    <span><b className="text-neutral-800 dark:text-neutral-200">{m.is_outgoing ? "You" : m.from_name || m.from_addr}</b>{!m.is_outgoing && m.from_name ? ` <${m.from_addr}>` : ""}</span>
                    <LocalTime iso={m.sent_at} mode="full" />
                  </header>
                  {m.body_text?.trim()
                    ? <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{m.body_text}</pre>
                    : <p className="text-sm italic text-neutral-500">No text content in this message (it may be only images or attachments). Press Sync to re-fetch if this is an older email.</p>}
                </article>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

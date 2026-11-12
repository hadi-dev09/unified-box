import Link from "next/link";
import { cookies } from "next/headers";
import { forwardBlock, isGroup, replyRecipients, replySubject, type Msg } from "@/lib/reply";
import { supabaseServer } from "@/lib/supabase/server";
import { assignClientAction } from "./actions";
import { Landing } from "./landing";
import { AutoSync } from "./auto-sync";
import { Composer, type Preset } from "./composer";
import { LocalTime } from "./local-time";
import { MarkSeen } from "./mark-seen";
import { MessageBody } from "./message-body";
import { MenuButton, Shell } from "./shell";
import { SyncButton } from "./sync-button";
import { Avatar, Icon, ProviderIcon, statusDot, statusLabel } from "./ui";

type Account = { id: string; provider: string; display_name: string; account_type: string; status: string; status_detail: string | null; last_synced_at: string | null; can_send: boolean; external_id: string };
type Thread = { id: string; subject: string | null; snippet: string | null; last_message_at: string; unread: boolean; needs_reply: boolean; last_from: string | null; account_id: string; accounts: { display_name: string; provider: string } | null; clients: { name: string } | null };
type Filter = "all" | "unread" | "reply";
type Search = { account?: string; client?: string; thread?: string; f?: string; q?: string; notice?: string };

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return <Landing />;
  const sp = await searchParams;
  const { account, client, thread } = sp;
  const filter: Filter = sp.f === "unread" || sp.f === "reply" ? sp.f : "all";
  const q = (sp.q ?? "").replace(/[%,()*_\\]/g, " ").trim().slice(0, 100);
  const collapsed = (await cookies()).get("ub_sidebar")?.value === "collapsed";

  const [{ data: accountRows }, { count: pending }, { data: counts }, { data: clientRows }] = await Promise.all([
    sb.from("accounts").select("id, provider, display_name, account_type, status, status_detail, last_synced_at, can_send, external_id").order("display_name"),
    sb.from("drafts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("threads").select("account_id, client_id, unread, needs_reply").limit(5000),
    sb.from("clients").select("id, name").order("name"),
  ]);
  const accounts = (accountRows ?? []) as Account[];
  const clients = (clientRows ?? []) as { id: string; name: string }[];

  const perAcct: Record<string, number> = {}, perClient: Record<string, number> = {};
  let unreadTotal = 0, replyTotal = 0;
  for (const c of counts ?? []) {
    if (c.unread) { unreadTotal++; perAcct[c.account_id] = (perAcct[c.account_id] ?? 0) + 1; if (c.client_id) perClient[c.client_id] = (perClient[c.client_id] ?? 0) + 1; }
    if (c.needs_reply) replyTotal++;
  }

  let tq = sb.from("threads").select("id, subject, snippet, last_message_at, unread, needs_reply, last_from, account_id, accounts(display_name, provider), clients(name)").order("last_message_at", { ascending: false }).limit(150);
  if (account) tq = tq.eq("account_id", account);
  if (client) tq = tq.eq("client_id", client);
  if (filter === "unread") tq = tq.eq("unread", true);
  if (filter === "reply") tq = tq.eq("needs_reply", true);
  if (q) tq = tq.or(`subject.ilike.%${q}%,snippet.ilike.%${q}%,last_from.ilike.%${q}%`);
  const threads = ((await tq).data ?? []) as unknown as Thread[];

  const [{ data: msgRows }, { data: cur }] = thread
    ? await Promise.all([
        sb.from("messages").select("id, from_name, from_addr, to_addrs, cc_addrs, sent_at, is_outgoing, body_text, subject").eq("thread_id", thread).order("sent_at"),
        sb.from("threads").select("id, subject, client_id, unread, external_id, account_id").eq("id", thread).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];
  const messages = (msgRows ?? []) as (Msg & { id: string })[];

  const qs = (o: Partial<Search>) => {
    const p = new URLSearchParams(Object.entries({ account, client, f: filter === "all" ? undefined : filter, q: q || undefined, ...o }).filter(([, v]) => v) as [string, string][]);
    return p.size ? `/?${p}` : "/";
  };
  const lastSynced = accounts.map((a) => a.last_synced_at).filter(Boolean).sort().pop() ?? null;
  const title = account ? accounts.find((a) => a.id === account)?.display_name ?? "Inbox" : client ? clients.find((c) => c.id === client)?.name ?? "Client" : "All inboxes";
  const open = Boolean(thread && cur);

  const navItem = (active: boolean) =>
    `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${active ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"}`;
  const badge = (n: number, active: boolean) => n > 0 && <span className={`ml-auto rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${active ? "bg-white/20 dark:bg-neutral-900/10" : "text-neutral-500"}`}>{n}</span>;

  const sidebar = (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div className="flex items-center gap-2 px-1 pt-1">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"><Icon name="inbox" /></span>
        <span className="text-[15px] font-semibold tracking-tight">Unified Box</span>
      </div>
      <nav className="space-y-0.5">
        <Link href="/" className={navItem(!account && !client)}><Icon name="inbox" /> All inboxes {badge(unreadTotal, !account && !client)}</Link>
      </nav>
      <div>
        <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Inboxes</p>
        <nav className="space-y-0.5">
          {accounts.length === 0 && <Link href="/settings" className="block px-2.5 py-2 text-sm text-blue-600">+ Connect an inbox</Link>}
          {accounts.map((a) => (
            <Link key={a.id} href={`/?account=${a.id}`} title={a.status_detail ?? statusLabel[a.status] ?? "Connected"} className={navItem(account === a.id)}>
              <span className="relative shrink-0">
                <ProviderIcon provider={a.provider} />
                <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-neutral-900 ${statusDot[a.status] ?? "bg-neutral-400"}`} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.display_name}</span>
                {statusLabel[a.status] && <span className="block text-[11px] text-amber-600">{statusLabel[a.status]}</span>}
              </span>
              {badge(perAcct[a.id] ?? 0, account === a.id)}
            </Link>
          ))}
        </nav>
      </div>
      {clients.length > 0 && (
        <div>
          <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Clients</p>
          <nav className="space-y-0.5">
            {clients.map((c) => (
              <Link key={c.id} href={`/?client=${c.id}`} className={navItem(client === c.id)}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-violet-500" /> <span className="truncate">{c.name}</span> {badge(perClient[c.id] ?? 0, client === c.id)}
              </Link>
            ))}
          </nav>
        </div>
      )}
      <nav className="mt-auto space-y-0.5 border-t border-neutral-200/70 pt-3 dark:border-neutral-800">
        <Link href="/approvals" className={navItem(false)}><Icon name="check" /> Approvals {pending ? <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{pending}</span> : null}</Link>
        <Link href="/connect-ai" className={navItem(false)}><Icon name="spark" /> Connect your AI</Link>
        <Link href="/settings" className={navItem(false)}><Icon name="settings" /> Accounts &amp; settings</Link>
        <form action="/auth/signout" method="post">
          <button className={`${navItem(false)} w-full`} title={user.email ?? undefined}><Icon name="back" /> Sign out <span className="ml-auto max-w-28 truncate text-[11px] text-neutral-400">{user.email}</span></button>
        </form>
      </nav>
    </div>
  );

  // ---------- reader ----------
  let reader: React.ReactNode = null;
  if (open && cur) {
    const acct = accounts.find((a) => a.id === cur.account_id);
    const self = acct?.external_id ?? "";
    const last = messages.at(-1);
    const presets: Record<"reply" | "reply_all" | "forward", Preset> = {
      reply: { ...replyRecipients("reply", messages, self), subject: replySubject("reply", cur.subject), body: "" },
      reply_all: { ...replyRecipients("reply_all", messages, self), subject: replySubject("reply_all", cur.subject), body: "" },
      forward: { to: [], cc: [], subject: replySubject("forward", cur.subject), body: last ? `\n${forwardBlock(last)}` : "" },
    };
    const openHref = acct?.provider === "slack"
      ? `https://slack.com/app_redirect?team=${encodeURIComponent(acct.external_id.split(":")[0])}&channel=${encodeURIComponent(cur.external_id)}`
      : acct ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(acct.external_id)}#all/${encodeURIComponent(cur.external_id)}` : null;
    const people = (m: Msg) => [...(m.to_addrs ?? []), ...(m.cc_addrs ?? [])].map((x) => (x.toLowerCase() === self.toLowerCase() ? "me" : x)).join(", ");

    reader = (
      <section className="flex min-w-0 flex-1 flex-col bg-white dark:bg-neutral-900" aria-label="Conversation">
        <MarkSeen threadId={cur.id} unread={Boolean(cur.unread)} />
        <header className="flex items-start gap-2 border-b border-neutral-200/70 px-4 py-3 dark:border-neutral-800 md:px-6">
          <Link href={qs({ thread: undefined })} aria-label="Close conversation" className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <Icon name="back" className="h-5 w-5 lg:hidden" /><Icon name="close" className="hidden h-5 w-5 lg:block" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-snug md:text-xl">{cur.subject || "(no subject)"}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
              <span className="inline-flex items-center gap-1"><ProviderIcon provider={acct?.provider} className="h-3.5 w-3.5" /> {acct?.display_name}</span>
              <span>{messages.length} message{messages.length === 1 ? "" : "s"}</span>
              {clients.length > 0 && (
                <form action={assignClientAction} className="inline-flex items-center gap-1">
                  <input type="hidden" name="thread" value={cur.id} />
                  <select name="client" defaultValue={cur.client_id ?? ""} aria-label="Client" className="rounded-md border border-neutral-200 bg-transparent px-1.5 py-0.5 dark:border-neutral-700">
                    <option value="">No client</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="rounded-md px-1.5 py-0.5 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">Save</button>
                </form>
              )}
            </div>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <div className="mx-auto max-w-3xl space-y-3">
            {messages.map((m, i) => {
              const name = m.is_outgoing ? "You" : m.from_name || m.from_addr || "Unknown";
              const head = (
                <div className="flex items-start gap-3">
                  <Avatar name={m.from_name || m.from_addr || "?"} you={m.is_outgoing} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold">{name}{!m.is_outgoing && m.from_name && <span className="ml-1.5 hidden font-normal text-neutral-500 sm:inline">{m.from_addr}</span>}</span>
                      <span className="shrink-0 text-xs text-neutral-500"><LocalTime iso={m.sent_at} mode="full" /></span>
                    </div>
                    {people(m) && <p className="truncate text-xs text-neutral-500">to {people(m)}</p>}
                  </div>
                </div>
              );
              const isLast = i === messages.length - 1;
              return isLast || messages.length <= 2 ? (
                <article key={m.id} className={`rounded-2xl border p-3 sm:p-4 ${m.is_outgoing ? "border-blue-100 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/20" : "border-neutral-200/70 dark:border-neutral-800"}`}>
                  {head}
                  <div className="mt-3 md:pl-12">{m.body_text?.trim() ? <MessageBody text={m.body_text} /> : <p className="text-sm italic text-neutral-500">No text in this message (it may contain only images or attachments).</p>}</div>
                </article>
              ) : (
                <details key={m.id} className="group rounded-2xl border border-neutral-200/70 p-3 sm:p-4 open:pb-4 dark:border-neutral-800">
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    {head}
                    <p className="mt-1 truncate text-sm text-neutral-500 group-open:hidden md:pl-12">{(m.body_text ?? "").replace(/\s+/g, " ").slice(0, 160)}</p>
                  </summary>
                  <div className="mt-3 md:pl-12"><MessageBody text={m.body_text ?? ""} /></div>
                </details>
              );
            })}
            <div className="pt-2">
              <Composer
                threadId={cur.id}
                provider={acct?.provider ?? "gmail"}
                canSend={Boolean(acct?.can_send)}
                showReplyAll={isGroup(messages, self)}
                presets={presets}
                reconnectHref={`/api/connect/gmail?type=${acct?.account_type ?? "personal"}&write=1`}
                openHref={openHref}
              />
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ---------- list ----------
  const wide = !open;
  const tab = (k: Filter, label: string, n?: number) => (
    <Link key={k} href={qs({ f: k === "all" ? undefined : k, thread: undefined })}
      className={`rounded-full px-3 py-1 text-sm transition ${filter === k ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "text-neutral-600 hover:bg-neutral-200/60 dark:text-neutral-400 dark:hover:bg-neutral-800"}`}>
      {label}{n ? <span className="ml-1 tabular-nums opacity-70">{n}</span> : null}
    </Link>
  );

  const list = (
    <section aria-label="Conversations" className={`${open ? "hidden lg:flex lg:w-[380px] xl:w-[420px] lg:shrink-0 lg:border-r lg:border-neutral-200/70 dark:lg:border-neutral-800" : "flex flex-1"} min-h-0 min-w-0 flex-col`}>
      <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 no-scrollbar md:px-4">
        {tab("all", "All")}{tab("unread", "Unread", unreadTotal)}{tab("reply", "Needs reply", replyTotal)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 md:px-3">
        {threads.length === 0 && (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-200/60 text-neutral-500 dark:bg-neutral-800"><Icon name="inbox" className="h-6 w-6" /></div>
            <p className="font-medium">{q ? "No matches" : filter === "all" ? "No conversations yet" : "All caught up"}</p>
            <p className="mt-1 text-sm text-neutral-500">{q ? `Nothing matches “${q}”.` : accounts.length ? "New mail appears here after a sync." : "Connect an inbox to get started."}</p>
            {!accounts.length && <Link href="/settings" className="mt-4 inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">Connect an inbox</Link>}
          </div>
        )}
        <ul className="space-y-0.5">
          {threads.map((t) => {
            const active = thread === t.id;
            const who = t.last_from || "(unknown)";
            return (
              <li key={t.id}>
                <Link href={qs({ thread: t.id })} aria-current={active ? "true" : undefined}
                  className={`group relative flex gap-3 rounded-xl px-3 py-2.5 transition ${active ? "bg-white shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700" : "hover:bg-white dark:hover:bg-neutral-900"} ${wide ? "lg:items-center" : ""}`}>
                  <span className={`absolute left-0.5 top-[18px] h-2 w-2 rounded-full ${t.unread ? "bg-blue-600" : "bg-transparent"} ${wide ? "lg:top-1/2 lg:-translate-y-1/2" : ""}`} aria-label={t.unread ? "Unread" : undefined} />
                  <Avatar name={who} you={who === "You"} size="md" />
                  <div className={`min-w-0 flex-1 ${wide ? "lg:flex lg:items-center lg:gap-4" : ""}`}>
                    <div className={`flex items-baseline gap-2 ${wide ? "lg:w-52 lg:shrink-0" : ""}`}>
                      <span className={`truncate text-sm ${t.unread ? "font-semibold" : "font-medium text-neutral-700 dark:text-neutral-300"}`}>{who}</span>
                      <span className={`ml-auto shrink-0 text-xs text-neutral-500 ${wide ? "lg:hidden" : ""}`}><LocalTime iso={t.last_message_at} /></span>
                    </div>
                    <div className={`min-w-0 ${wide ? "lg:flex lg:flex-1 lg:items-center lg:gap-2" : ""}`}>
                      <p className={`truncate text-sm ${t.unread ? "font-semibold" : "text-neutral-700 dark:text-neutral-300"} ${wide ? "lg:max-w-[45%] lg:shrink-0" : ""}`}>{t.subject || "(no subject)"}</p>
                      <p className={`truncate text-sm text-neutral-500 ${wide ? "lg:min-w-0 lg:flex-1" : ""}`}>{wide && <span className="hidden lg:inline">— </span>}{t.snippet}</p>
                    </div>
                    <div className={`mt-1 flex items-center gap-1.5 ${wide ? "lg:mt-0 lg:shrink-0" : ""}`}>
                      {!account && t.accounts && <span className="inline-flex max-w-40 items-center gap-1 truncate rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"><ProviderIcon provider={t.accounts.provider} className="h-3 w-3" />{t.accounts.display_name.split("@")[0]}</span>}
                      {t.clients?.name && <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200">{t.clients.name}</span>}
                      {t.needs_reply && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">Reply</span>}
                      {wide && <span className="ml-auto hidden w-16 text-right text-xs text-neutral-500 lg:inline"><LocalTime iso={t.last_message_at} /></span>}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );

  return (
    <Shell sidebar={sidebar} initialCollapsed={collapsed}>
      <AutoSync enabled={accounts.some((a) => a.status === "connected" || a.status === "error")} lastSyncedAt={lastSynced} />
      {sp.notice === "password-updated" && <p className="bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">Your password was updated.</p>}
      <header className={`${open ? "hidden md:flex" : "flex"} items-center gap-2 border-b border-neutral-200/70 bg-neutral-100/80 px-3 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80 md:px-4`}>
        <MenuButton />
        <div className="min-w-0 shrink">
          <h2 className="truncate text-sm font-semibold md:text-base">{title}</h2>
        </div>
        <form action="/" className="ml-auto flex min-w-0 max-w-md flex-1 items-center md:ml-4">
          {account && <input type="hidden" name="account" value={account} />}
          {client && <input type="hidden" name="client" value={client} />}
          {filter !== "all" && <input type="hidden" name="f" value={filter} />}
          <label className="flex w-full items-center gap-2 rounded-xl bg-white px-3 py-1.5 ring-1 ring-neutral-200 focus-within:ring-neutral-400 dark:bg-neutral-900 dark:ring-neutral-800">
            <Icon name="search" className="h-4 w-4 shrink-0 text-neutral-400" />
            <input name="q" defaultValue={q} placeholder="Search mail" className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400" />
          </label>
        </form>
        <SyncButton />
      </header>
      {!open && (accounts.length > 1 || clients.length > 0) && (
        <div className="flex gap-2 overflow-x-auto border-b border-neutral-200/70 px-3 py-2 no-scrollbar dark:border-neutral-800 md:hidden">
          <Link href={qs({ account: undefined, client: undefined, thread: undefined })} className={`shrink-0 rounded-full px-3 py-1 text-sm ${!account && !client ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "bg-white ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"}`}>All</Link>
          {accounts.map((a) => (
            <Link key={a.id} href={qs({ account: a.id, client: undefined, thread: undefined })} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm ${account === a.id ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "bg-white ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusDot[a.status] ?? "bg-neutral-400"}`} />{a.display_name.split("@")[0]}{perAcct[a.id] ? ` · ${perAcct[a.id]}` : ""}
            </Link>
          ))}
          {clients.map((c) => (
            <Link key={c.id} href={qs({ account: undefined, client: c.id, thread: undefined })} className={`shrink-0 rounded-full px-3 py-1 text-sm ${client === c.id ? "bg-violet-600 text-white" : "bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200"}`}>{c.name}</Link>
          ))}
        </div>
      )}
      {accounts.some((a) => a.status !== "connected") && !open && (
        <Link href="/settings" className="mx-3 mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-900 md:mx-4">
          Some inboxes need attention. Open Accounts &amp; settings to reconnect.
        </Link>
      )}
      <div className="flex min-h-0 flex-1">
        {list}
        {reader}
      </div>
    </Shell>
  );
}

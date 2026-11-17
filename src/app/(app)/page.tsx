import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { inboxSummary } from "@/lib/inbox-summary";
import { forwardBlock, isGroup, replyRecipients, replySubject, type Msg } from "@/lib/reply";
import { cleanQuery, matchingThreadIds } from "@/lib/search";
import { supabaseServer } from "@/lib/supabase/server";
import { assignClientAction } from "../actions";
import { Landing } from "../landing";
import { Composer, type Preset } from "../composer";
import { DraftActions } from "./approvals/draft-actions";
import { LocalTime } from "../local-time";
import { MarkSeen } from "../mark-seen";
import { MessageBody } from "../message-body";
import { ReaderActions, ScrollToDraft } from "../reader-actions";
import { SearchBox } from "../search-box";
import { ScheduledCard } from "../schedule-button";
import { MenuButton, SyncStatus } from "../shell";
import { ThreadList, type ListThread } from "../thread-list";
import { accountName, Avatar, channel, ChannelTag, Icon, shortName } from "../ui";
import { AiSummary } from "../ai-helper";
import { aiKeyInfo } from "@/lib/ai-assist";

type ThreadRow = {
  id: string; subject: string | null; snippet: string | null; last_message_at: string; unread: boolean; needs_reply: boolean; last_from: string | null;
  account_id: string; starred: boolean | null; snoozed_until: string | null; trashed_at: string | null; clients: { name: string } | null;
};
const VIEWS = ["all", "unread", "reply", "starred", "snoozed", "trash"] as const;
type View = (typeof VIEWS)[number];
type Search = { account?: string; client?: string; provider?: string; thread?: string; f?: string; q?: string; notice?: string; draft?: string };

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await currentUser();
  if (!user) return <Landing />;
  const sb = await supabaseServer();
  const sp = await searchParams;
  const { account, client, thread } = sp;
  const view: View = (VIEWS as readonly string[]).includes(sp.f ?? "") ? (sp.f as View) : "all";
  const q = cleanQuery(sp.q);

  const { accounts, clients, perAcct, unreadTotal, replyTotal } = await inboxSummary();
  const provider = sp.provider && accounts.some((a) => a.provider === sp.provider) ? sp.provider : undefined;
  const acctById = new Map(accounts.map((a) => [a.id, a]));

  const searchIds = q ? await matchingThreadIds(sb, user.id, q) : null;
  let tq = sb.from("threads").select("id, subject, snippet, last_message_at, unread, needs_reply, last_from, account_id, starred, snoozed_until, trashed_at, clients(name)").eq("user_id", user.id).order("last_message_at", { ascending: false }).limit(150);
  if (view === "trash") tq = tq.not("trashed_at", "is", null);
  else {
    tq = tq.is("trashed_at", null);
    tq = view === "snoozed" ? tq.not("snoozed_until", "is", null) : tq.is("snoozed_until", null);
  }
  if (account) tq = tq.eq("account_id", account);
  if (provider) tq = tq.in("account_id", accounts.filter((a) => a.provider === provider).map((a) => a.id));
  if (client) tq = tq.eq("client_id", client);
  if (view === "unread") tq = tq.eq("unread", true);
  if (view === "reply") tq = tq.eq("needs_reply", true);
  if (view === "starred") tq = tq.eq("starred", true);
  if (searchIds) tq = tq.in("id", searchIds.length ? searchIds.slice(0, 200) : ["00000000-0000-0000-0000-000000000000"]);

  const [{ data: threadRows }, { data: msgRows }, { data: cur }, { data: aiDrafts }] = await Promise.all([
    tq,
    thread ? sb.from("messages").select("id, from_name, from_addr, to_addrs, cc_addrs, sent_at, is_outgoing, body_text, subject").eq("thread_id", thread).order("sent_at") : Promise.resolve({ data: null }),
    thread ? sb.from("threads").select("id, subject, client_id, unread, external_id, account_id, starred").eq("id", thread).maybeSingle() : Promise.resolve({ data: null }),
    thread ? sb.from("drafts").select("id, subject, body, to_addrs, cc_addrs, created_by, status, send_at").eq("thread_id", thread).in("status", ["pending", "scheduled"]).order("created_at") : Promise.resolve({ data: null }),
  ]);
  const threads = (threadRows ?? []) as unknown as ThreadRow[];
  const hasAiKey = thread ? Boolean(await aiKeyInfo(user.id)) : false;
  const messages = (msgRows ?? []) as (Msg & { id: string })[];

  const qs = (o: Partial<Search>) => {
    const p = new URLSearchParams(Object.entries({ account, client, provider, f: view === "all" ? undefined : view, q: q || undefined, ...o }).filter(([, v]) => v) as [string, string][]);
    return p.size ? `/?${p}` : "/";
  };
  const selAcct = account ? acctById.get(account) : undefined;
  const title = q ? `Results for “${q}”` : selAcct ? accountName(selAcct) : provider ? `All ${channel(provider).name}` : client ? clients.find((c) => c.id === client)?.name ?? "Client" : "All inboxes";
  const open = Boolean(thread && cur);

  // ---------- reader ----------
  let reader: React.ReactNode = null;
  if (open && cur) {
    const acct = acctById.get(cur.account_id);
    const self = acct?.external_id ?? "";
    const last = messages.at(-1);
    const isChat = Boolean(acct && !["gmail", "outlook", "imap"].includes(acct.provider));
    const presets: Record<"reply" | "reply_all" | "forward", Preset> = {
      reply: { ...replyRecipients("reply", messages, self), subject: replySubject("reply", cur.subject), body: "" },
      reply_all: { ...replyRecipients("reply_all", messages, self), subject: replySubject("reply_all", cur.subject), body: "" },
      forward: { to: [], cc: [], subject: replySubject("forward", cur.subject), body: last ? `\n${forwardBlock(last)}` : "" },
    };
    const openHref = !acct ? null
      : acct.provider === "slack" ? `https://slack.com/app_redirect?team=${encodeURIComponent(acct.external_id.split(":")[0])}&channel=${encodeURIComponent(cur.external_id)}`
      : acct.provider === "gmail" ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(acct.external_id)}#all/${encodeURIComponent(cur.external_id)}`
      : acct.provider === "outlook" ? "https://outlook.office.com/mail/"
      : acct.provider === "whatsapp" ? `https://wa.me/${encodeURIComponent(cur.external_id)}`
      : acct.provider === "whatsapp_web" ? `https://wa.me/${encodeURIComponent(cur.external_id.split("@")[0])}`
      : acct.provider === "telegram" ? "https://web.telegram.org/"
      : null;
    const reconnectHref = acct?.provider === "outlook" ? "/api/connect/outlook?write=1" : acct?.provider === "slack" ? "/api/connect/slack?write=1" : acct?.provider === "gmail" ? "/api/connect/gmail?write=1" : "/settings";
    const people = (m: Msg) => [...(m.to_addrs ?? []), ...(m.cc_addrs ?? [])].map((x) => (x.toLowerCase() === self.toLowerCase() ? "me" : x)).join(", ");
    const closeHref = qs({ thread: undefined, draft: undefined });

    reader = (
      <section className="flex min-w-0 flex-1 flex-col bg-[var(--surface)] lg:rounded-tl-2xl lg:border-l lg:border-t lg:border-[var(--border)]" aria-label="Conversation">
        <MarkSeen threadId={cur.id} unread={Boolean(cur.unread)} />
        {sp.draft && <ScrollToDraft id={sp.draft} />}
        <header className="flex items-start gap-2 border-b border-[var(--border)] px-3 py-3 md:px-6">
          <Link href={closeHref} aria-label="Close conversation" className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
            <Icon name="back" className="h-5 w-5 lg:hidden" /><Icon name="close" className="hidden h-5 w-5 lg:block" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold leading-snug tracking-tight md:text-xl">{cur.subject || "(no subject)"}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs muted">
              {acct && <ChannelTag provider={acct.provider} label={accountName(acct)} />}
              <span>{messages.length} message{messages.length === 1 ? "" : "s"}</span>
              {clients.length > 0 && (
                <form action={assignClientAction} className="inline-flex items-center gap-1">
                  <input type="hidden" name="thread" value={cur.id} />
                  <select name="client" defaultValue={cur.client_id ?? ""} aria-label="Client" className="h-7 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-1.5 text-xs">
                    <option value="">No client</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="h-7 rounded-lg px-2 font-medium text-[var(--accent-text)] hover:bg-[var(--surface-2)]">Save</button>
                </form>
              )}
            </div>
          </div>
          <ReaderActions id={cur.id} starred={Boolean(cur.starred)} closeHref={closeHref} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
          <div className="mx-auto max-w-3xl space-y-3">
            {messages.length > 1 && <AiSummary threadId={cur.id} hasKey={hasAiKey} />}
            {messages.map((m, i) => {
              const name = m.is_outgoing ? "You" : m.from_name || m.from_addr || "Unknown";
              const head = (
                <div className="flex items-start gap-3">
                  <Avatar name={m.from_name || m.from_addr || "?"} you={m.is_outgoing} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold">{name}{!m.is_outgoing && m.from_name && !isChat && <span className="ml-1.5 hidden font-normal muted sm:inline">{m.from_addr}</span>}</span>
                      <span className="shrink-0 text-xs muted"><LocalTime iso={m.sent_at} mode="full" /></span>
                    </div>
                    {people(m) && !isChat && <p className="truncate text-xs muted">to {people(m)}</p>}
                  </div>
                </div>
              );
              const isLast = i === messages.length - 1;
              return isLast || messages.length <= 2 ? (
                <article key={m.id} className={`rounded-2xl border p-3 sm:p-4 ${m.is_outgoing ? "border-[var(--accent)]/20 bg-[var(--accent-soft)]" : "border-[var(--border)]"}`}>
                  {head}
                  <div className="mt-3 md:pl-12">{m.body_text?.trim() ? <MessageBody text={m.body_text} /> : <p className="text-sm italic muted">No text in this message (it may contain only images or attachments).</p>}</div>
                </article>
              ) : (
                <details key={m.id} className="group rounded-2xl border border-[var(--border)] p-3 open:pb-4 sm:p-4">
                  <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    {head}
                    <p className="mt-1 truncate text-sm muted group-open:hidden md:pl-12">{(m.body_text ?? "").replace(/\s+/g, " ").slice(0, 160)}</p>
                  </summary>
                  <div className="mt-3 md:pl-12"><MessageBody text={m.body_text ?? ""} /></div>
                </details>
              );
            })}
            {((aiDrafts ?? []) as { id: string; body: string; to_addrs: string[]; status: string; send_at: string | null }[]).filter((d) => d.status === "scheduled" && d.send_at).map((d) => (
              <ScheduledCard key={d.id} id={d.id} sendAt={d.send_at!} body={d.body} to={d.to_addrs.length ? `To ${d.to_addrs.join(", ")}` : "In this chat"} />
            ))}
            {((aiDrafts ?? []) as { id: string; subject: string; body: string; to_addrs: string[]; cc_addrs: string[] | null; created_by: string; status: string }[]).filter((d) => d.status === "pending").map((d) => (
              <div key={d.id} id={`draft-${d.id}`} className={`scroll-mt-24 rounded-2xl border p-4 ${sp.draft === d.id ? "border-violet-400 ring-4 ring-violet-500/15" : "border-violet-300/60"} bg-violet-500/5`}>
                <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                  <Icon name="spark" className="h-3.5 w-3.5" /> {d.created_by === "claude" ? "Reply drafted by your AI" : "Your saved draft"} · not sent yet
                </p>
                <p className="mb-2 text-xs muted">{d.to_addrs.length ? `To ${[...d.to_addrs, ...(d.cc_addrs ?? [])].join(", ")}` : "Reply in this chat"}</p>
                <DraftActions id={d.id} subject={d.subject} body={d.body} />
              </div>
            ))}
            <div className="pt-2">
              <Composer threadId={cur.id} provider={acct?.provider ?? "gmail"} canSend={Boolean(acct?.can_send)} showReplyAll={isGroup(messages, self)}
                presets={presets} reconnectHref={reconnectHref} openHref={openHref} hasAiKey={hasAiKey} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ---------- list ----------
  const listThreads: ListThread[] = threads.map((t) => {
    const a = acctById.get(t.account_id);
    return {
      id: t.id, subject: t.subject, snippet: t.snippet, last_message_at: t.last_message_at, unread: t.unread, needs_reply: t.needs_reply, last_from: t.last_from,
      starred: Boolean(t.starred), snoozed_until: t.snoozed_until, trashed_at: t.trashed_at, provider: a?.provider ?? null,
      accountLabel: a ? shortName(accountName(a)) : "", client: t.clients?.name ?? null,
    };
  });
  const hrefFor = Object.fromEntries(threads.map((t) => [t.id, qs({ thread: t.id, draft: undefined })]));
  const tab = (k: View, label: string, n?: number) => (
    <Link key={k} href={qs({ f: k === "all" ? undefined : k, thread: undefined })}
      className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium transition ${view === k ? "bg-[var(--text)] text-[var(--bg)]" : "muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]"}`}>
      {label}{n ? <span className="ml-1.5 tabular-nums opacity-70">{n}</span> : null}
    </Link>
  );
  const emptyText = q ? `Nothing matches “${q}”.` : view === "trash" ? "Trash is empty." : view === "snoozed" ? "Nothing snoozed." : view === "starred" ? "Star important conversations to find them here." : accounts.length ? "New messages appear here automatically." : "Connect an inbox to get started.";

  const list = (
    <section aria-label="Conversations" className={`${open ? "hidden lg:flex lg:w-[400px] lg:shrink-0 xl:w-[440px]" : "flex flex-1"} min-h-0 min-w-0 flex-col`}>
      <div className="flex items-center gap-1 overflow-x-auto px-3 py-2.5 no-scrollbar md:px-4">
        {tab("all", "All")}{tab("unread", "Unread", unreadTotal)}{tab("reply", "Needs reply", replyTotal)}{tab("starred", "Starred")}{tab("snoozed", "Snoozed")}{tab("trash", "Trash")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 md:px-3">
        {threads.length === 0 ? (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface-2)] muted"><Icon name={q ? "search" : "inbox"} className="h-6 w-6" /></div>
            <p className="font-semibold">{q ? "No matches" : view === "all" ? "No conversations yet" : "All clear"}</p>
            <p className="mt-1 text-sm muted">{emptyText}</p>
            {q && <Link href={qs({ q: undefined })} className="btn mt-4">Clear search</Link>}
            {!accounts.length && <Link href="/settings" className="btn-primary mt-4">Connect an inbox</Link>}
          </div>
        ) : (
          <ThreadList threads={listThreads} activeId={thread ?? null} hrefFor={hrefFor} showChannel={!account} view={view} />
        )}
      </div>
    </section>
  );

  return (
    <>
      {sp.notice === "password-updated" && <p className="bg-emerald-500/10 px-4 py-2 text-center text-sm text-emerald-700 dark:text-emerald-300">Your password was updated.</p>}
      <header className={`${open ? "hidden lg:flex" : "flex"} h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)]/80 px-3 backdrop-blur md:gap-3 md:px-5`}>
        <MenuButton />
        <h2 className="hidden min-w-0 max-w-[30%] truncate text-[15px] font-semibold sm:block md:text-base">{title}</h2>
        <div className="mx-auto w-full max-w-xl"><SearchBox initial={q} /></div>
        <SyncStatus />
      </header>
      {!open && (accounts.length > 1 || clients.length > 0) && (
        <div className="flex gap-2 overflow-x-auto border-b border-[var(--border)] px-3 py-2 no-scrollbar md:hidden">
          <Link href={qs({ account: undefined, client: undefined, provider: undefined, thread: undefined })} className={`chip !px-3 !py-1 !text-[13px] ${!account && !client && !provider ? "bg-[var(--text)] text-[var(--bg)]" : "bg-[var(--surface)] ring-1 ring-[var(--border)]"}`}>All</Link>
          {[...new Set(accounts.map((a) => a.provider))].map((p) => (
            <Link key={p} href={qs({ provider: p, account: undefined, client: undefined, thread: undefined })} className="chip !px-3 !py-1 !text-[13px]" style={provider === p ? { background: channel(p).color, color: "white" } : { background: channel(p).soft, color: channel(p).color }}>{channel(p).name}</Link>
          ))}
          {accounts.map((a) => (
            <Link key={a.id} href={qs({ account: a.id, client: undefined, provider: undefined, thread: undefined })} className={`chip !px-3 !py-1 !text-[13px] ${account === a.id ? "bg-[var(--text)] text-[var(--bg)]" : "bg-[var(--surface)] ring-1 ring-[var(--border)]"}`}>
              {shortName(accountName(a))}{perAcct[a.id] ? ` · ${perAcct[a.id]}` : ""}
            </Link>
          ))}
          {clients.map((c) => (
            <Link key={c.id} href={qs({ account: undefined, client: c.id, provider: undefined, thread: undefined })} className={`chip !px-3 !py-1 !text-[13px] ${client === c.id ? "bg-violet-600 text-white" : "bg-violet-500/12 text-violet-700 dark:text-violet-300"}`}>{c.name}</Link>
          ))}
        </div>
      )}
      {accounts.some((a) => a.status !== "connected") && !open && (
        <Link href="/settings" className="mx-3 mt-2 flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 ring-1 ring-amber-500/25 dark:text-amber-200 md:mx-4">
          <span className="h-2 w-2 rounded-full bg-amber-500" /> Some inboxes need attention. Open Settings to reconnect.
        </Link>
      )}
      <div className="flex min-h-0 flex-1 lg:pt-2">
        {list}
        {reader}
      </div>
    </>
  );
}

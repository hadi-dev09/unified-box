"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { SummaryAccount } from "@/lib/inbox-summary";
import { renameAccountAction } from "./actions";
import { ThemeSwitch } from "./theme-switch";
import { accountName, channel, ChannelAvatar, Icon, ProviderIcon, statusDot, statusLabel } from "./ui";

type Props = {
  accounts: SummaryAccount[]; clients: { id: string; name: string }[];
  perAcct: Record<string, number>; perClient: Record<string, number>; perProvider: Record<string, number>;
  unreadTotal: number; pending: number; email: string; name?: string; avatarUrl?: string | null;
};

const ORDER = ["gmail", "outlook", "slack", "whatsapp", "telegram"];

export function SidebarNav({ accounts, clients, perAcct, perClient, perProvider, unreadTotal, pending, email, name = "", avatarUrl = null }: Props) {
  const path = usePathname();
  const sp = useSearchParams();
  const onInbox = path === "/";
  const account = onInbox ? sp.get("account") : null;
  const client = onInbox ? sp.get("client") : null;
  const providerSel = onInbox ? sp.get("provider") : null;
  const providers = [...new Set(accounts.map((a) => a.provider))].sort((a, b) => (ORDER.indexOf(a) + 99 * +(ORDER.indexOf(a) < 0)) - (ORDER.indexOf(b) + 99 * +(ORDER.indexOf(b) < 0)));

  // Which channel groups are expanded (remembered on this device).
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setOpen(JSON.parse(localStorage.getItem("ub_groups") ?? "{}")); } catch { /* ignore */ } }, []);
  const toggle = (p: string) => setOpen((o) => { const n = { ...o, [p]: !(o[p] ?? true) }; try { localStorage.setItem("ub_groups", JSON.stringify(n)); } catch { /* ignore */ } return n; });

  const item = (active: boolean) =>
    `group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13.5px] transition ${active ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]" : "text-[var(--text)]/80 hover:bg-[var(--surface-2)]"}`;
  const badge = (n: number) => n > 0 && <span className="ml-auto min-w-5 rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold tabular-nums text-white">{n}</span>;
  const section = "mb-1.5 mt-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider muted";

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <Link href="/" className="flex items-center gap-2.5 px-1.5 pb-1 pt-1.5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shadow-sm"><Icon name="inbox" /></span>
        <span className="text-[15px] font-bold tracking-tight">Unified Box</span>
      </Link>

      <nav>
        <Link href="/" className={item(onInbox && !account && !client && !providerSel)}><Icon name="inbox" /> All inboxes {badge(unreadTotal)}</Link>
      </nav>

      <div>
        <p className={section}>Channels</p>
        {accounts.length === 0 && <Link href="/settings" className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium text-[var(--accent-text)] hover:bg-[var(--surface-2)]"><Icon name="plus" /> Connect a channel</Link>}
        <nav className="space-y-0.5">
          {providers.map((p) => {
            const c = channel(p);
            const list = accounts.filter((a) => a.provider === p);
            const expanded = open[p] ?? true;
            return (
              <div key={p}>
                <div className={`${item(providerSel === p)} pr-1`}>
                  <Link href={`/?provider=${p}`} className="flex min-w-0 flex-1 items-center gap-2.5" title={`All ${c.name} messages`}>
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: c.color }}><ProviderIcon provider={p} className="h-3.5 w-3.5" /></span>
                    <span className="truncate">{c.name}</span>
                    {badge(perProvider[p] ?? 0)}
                  </Link>
                  <button type="button" onClick={() => toggle(p)} aria-label={`${expanded ? "Hide" : "Show"} ${c.name} accounts`} aria-expanded={expanded}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md muted hover:bg-[var(--surface-3)]">
                    <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} />
                  </button>
                </div>
                {expanded && (
                  <div className="ml-[19px] mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-2">
                    {list.map((a) => <AccountRow key={a.id} a={a} active={account === a.id} count={perAcct[a.id] ?? 0} />)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {clients.length > 0 && (
        <div>
          <p className={section}>Clients</p>
          <nav className="space-y-0.5">
            {clients.map((c) => (
              <Link key={c.id} href={`/?client=${c.id}`} className={item(client === c.id)}>
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-[10px] font-bold text-violet-600 dark:text-violet-300">{c.name.slice(0, 2).toUpperCase()}</span>
                <span className="truncate">{c.name}</span> {badge(perClient[c.id] ?? 0)}
              </Link>
            ))}
          </nav>
        </div>
      )}

      <nav className="mt-auto space-y-0.5 border-t border-[var(--border)] pt-3">
        <Link href="/approvals" className={item(path.startsWith("/approvals"))}><Icon name="spark" /> Drafts &amp; scheduled {pending ? <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{pending}</span> : null}</Link>
        <Link href="/connect-ai" className={item(path.startsWith("/connect-ai"))}><Icon name="plug" /> Connect your AI</Link>
        <Link href="/settings" className={item(path.startsWith("/settings"))}><Icon name="settings" /> Settings</Link>
        <div className="flex items-center gap-2 px-1.5 pt-2">
          <ThemeSwitch />
          <form action="/auth/signout" method="post" className="ml-auto">
            <button className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]" title={`Sign out ${email}`}><Icon name="logout" className="h-3.5 w-3.5" /> Sign out</button>
          </form>
        </div>
        <Link href="/profile" title="Your profile" className={`mt-1 flex items-center gap-2.5 rounded-xl px-2 py-2 transition ${path.startsWith("/profile") ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"}`}>
          {avatarUrl
            ? <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-[var(--border)]" />
            : <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-xs font-bold text-white">{(name || email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?"}</span>}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{name || email.split("@")[0]}</span>
            <span className="block truncate text-[11px] muted">{email}</span>
          </span>
        </Link>
      </nav>
    </div>
  );
}

function AccountRow({ a, active, count }: { a: SummaryAccount; active: boolean; count: number }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(accountName(a));
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  useEffect(() => { setName(accountName(a)); }, [a]);
  const save = () => start(async () => { await renameAccountAction(a.id, name === a.display_name ? "" : name); setEditing(false); });

  if (editing) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="flex items-center gap-1.5 rounded-xl px-1.5 py-1">
        <ChannelAvatar provider={a.provider} name={name || a.display_name} size="sm" />
        <input ref={ref} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Account name"
          onKeyDown={(e) => e.key === "Escape" && (setEditing(false), setName(accountName(a)))} onBlur={save} disabled={pending}
          className="field !px-2 !py-1 text-[13px]" />
      </form>
    );
  }
  return (
    <Link href={`/?account=${a.id}`} title={a.status_detail ?? (a.label ? a.display_name : statusLabel[a.status]) ?? a.display_name}
      className={`group/acc flex items-center gap-2 rounded-xl px-1.5 py-1.5 text-[13px] transition ${active ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]" : "text-[var(--text)]/75 hover:bg-[var(--surface-2)]"}`}>
      <span className="relative">
        <ChannelAvatar provider={a.provider} name={accountName(a)} size="sm" />
        <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[var(--surface)] ${statusDot[a.status] ?? "bg-neutral-400"}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{accountName(a)}</span>
        {statusLabel[a.status] && <span className="block text-[11px] font-medium text-amber-600">{statusLabel[a.status]}</span>}
      </span>
      <button type="button" aria-label={`Rename ${accountName(a)}`} title="Rename"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
        className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md muted hover:bg-[var(--surface-3)] group-hover/acc:inline-flex group-focus-within/acc:inline-flex">
        <Icon name="pencil" className="h-3 w-3" />
      </button>
      {count > 0 && <span className="min-w-5 rounded-full bg-[var(--accent)] px-1.5 text-center text-[11px] font-semibold tabular-nums text-white">{count}</span>}
    </Link>
  );
}

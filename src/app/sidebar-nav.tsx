"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { SummaryAccount } from "@/lib/inbox-summary";
import { Icon, ProviderIcon, statusDot, statusLabel } from "./ui";

type Props = {
  accounts: SummaryAccount[]; clients: { id: string; name: string }[];
  perAcct: Record<string, number>; perClient: Record<string, number>;
  unreadTotal: number; pending: number; email: string;
};

export function SidebarNav({ accounts, clients, perAcct, perClient, unreadTotal, pending, email }: Props) {
  const path = usePathname();
  const sp = useSearchParams();
  const account = path === "/" ? sp.get("account") : null;
  const client = path === "/" ? sp.get("client") : null;

  const item = (active: boolean) =>
    `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${active ? "bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900" : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"}`;
  const badge = (n: number, active: boolean) => n > 0 && (
    <span className={`ml-auto min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums ${active ? "bg-white/20 dark:bg-neutral-900/10" : "bg-blue-600 text-white"}`}>{n}</span>
  );
  const section = "mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400";

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <Link href="/" className="flex items-center gap-2 px-1 pt-1">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"><Icon name="inbox" /></span>
        <span className="text-[15px] font-semibold tracking-tight">Unified Box</span>
      </Link>
      <nav className="space-y-0.5">
        <Link href="/" className={item(path === "/" && !account && !client)}><Icon name="inbox" /> All inboxes {badge(unreadTotal, path === "/" && !account && !client)}</Link>
      </nav>
      <div>
        <p className={section}>Inboxes</p>
        <nav className="space-y-0.5">
          {accounts.length === 0 && <Link href="/settings" className="block px-2.5 py-2 text-sm font-medium text-blue-600">+ Connect an inbox</Link>}
          {accounts.map((a) => (
            <Link key={a.id} href={`/?account=${a.id}`} title={a.status_detail ?? statusLabel[a.status] ?? "Connected"} className={item(account === a.id)}>
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
          <p className={section}>Clients</p>
          <nav className="space-y-0.5">
            {clients.map((c) => (
              <Link key={c.id} href={`/?client=${c.id}`} className={item(client === c.id)}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-violet-500" /> <span className="truncate">{c.name}</span> {badge(perClient[c.id] ?? 0, client === c.id)}
              </Link>
            ))}
          </nav>
        </div>
      )}
      <nav className="mt-auto space-y-0.5 border-t border-neutral-200/70 pt-3 dark:border-neutral-800">
        <Link href="/approvals" className={item(path.startsWith("/approvals"))}><Icon name="spark" /> AI drafts {pending ? <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{pending}</span> : null}</Link>
        <Link href="/connect-ai" className={item(path.startsWith("/connect-ai"))}><Icon name="plug" /> Connect your AI</Link>
        <Link href="/settings" className={item(path.startsWith("/settings"))}><Icon name="settings" /> Accounts &amp; settings</Link>
        <form action="/auth/signout" method="post">
          <button className={`${item(false)} w-full`} title={email}><Icon name="logout" /> Sign out <span className="ml-auto max-w-28 truncate text-[11px] text-neutral-400">{email}</span></button>
        </form>
      </nav>
    </div>
  );
}

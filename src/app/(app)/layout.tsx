import { currentUser } from "@/lib/auth";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { inboxSummary } from "@/lib/inbox-summary";
import { supabaseServer } from "@/lib/supabase/server";
import { aiKeyInfo } from "@/lib/ai-assist";
import { AiPanel } from "../ai-panel";
import { LiveSync } from "../live-sync";
import { Shell } from "../shell";
import { SidebarNav } from "../sidebar-nav";

export async function generateMetadata() {
  const user = await currentUser();
  if (!user) return {};
  const { unreadTotal } = await inboxSummary();
  return { title: unreadTotal > 0 ? `(${unreadTotal}) Unified Box` : "Unified Box" };
}

/** Shared frame for the signed-in app: sidebar on every page, automatic mail refresh. Signed-out visitors see the page as-is. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) return <>{children}</>;
  const s = await inboxSummary();
  const collapsed = (await cookies()).get("ub_sidebar")?.value === "collapsed";
  const hasAi = Boolean(await aiKeyInfo(user.id));
  return (
    <Shell
      initialCollapsed={collapsed}
      sidebar={<Suspense><SidebarNav accounts={s.accounts} clients={s.clients} perAcct={s.perAcct} perClient={s.perClient} perProvider={s.perProvider} unreadTotal={s.unreadTotal} pending={s.pending} email={user.email ?? ""} name={user.name} avatarUrl={user.avatarUrl} /></Suspense>}
      status={<LiveSync enabled={s.accounts.some((a) => a.status === "connected" || a.status === "error")} lastSyncedAt={s.lastSynced} unreadTotal={s.unreadTotal} slack={s.accounts.some((a) => a.status === "connected" && (a.provider === "slack" || Boolean(a.remote_id)))} />}
    >
      {children}
      {hasAi && <Suspense><AiPanel /></Suspense>}
    </Shell>
  );
}

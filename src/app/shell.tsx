"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "./ui";

const Ctx = createContext<{ toggle: () => void; collapsed: boolean; status: React.ReactNode }>({ toggle: () => {}, collapsed: false, status: null });

/** App frame: collapsible sidebar on desktop (remembered in a cookie), slide-in drawer on phones. */
export function Shell({ sidebar, children, initialCollapsed, status = null }: { sidebar: React.ReactNode; children: React.ReactNode; initialCollapsed: boolean; status?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();
  const params = useSearchParams();
  useEffect(() => setDrawer(false), [path, params]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const toggle = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      const next = !collapsed;
      setCollapsed(next);
      document.cookie = `ub_sidebar=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
    } else setDrawer(true);
  };

  return (
    <Ctx.Provider value={{ toggle, collapsed, status }}>
      <div className="flex h-dvh overflow-hidden">
        <aside className={`${collapsed ? "md:hidden" : "md:flex"} hidden w-64 shrink-0 flex-col border-r border-neutral-200/70 bg-white dark:border-neutral-800 dark:bg-neutral-900`}>
          {sidebar}
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
            <button aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-neutral-900">{sidebar}</aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </Ctx.Provider>
  );
}

export function MenuButton() {
  const { toggle, collapsed } = useContext(Ctx);
  return (
    <button onClick={toggle} aria-label={collapsed ? "Show sidebar" : "Toggle sidebar"} title="Show / hide sidebar"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
      <Icon name="menu" className="h-5 w-5" />
    </button>
  );
}

/** The live "Updated just now" indicator, placed by each page header. */
export function SyncStatus() {
  return <>{useContext(Ctx).status}</>;
}

/** Header + scroll area for secondary pages (AI drafts, Settings, Connect your AI). */
export function PageFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-neutral-200/70 bg-neutral-100/80 px-3 py-2 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80 md:px-4">
        <MenuButton />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold md:text-base">{title}</h1>
        <SyncStatus />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

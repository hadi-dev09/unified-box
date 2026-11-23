"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { NavProgress } from "./nav-progress";
import { Icon } from "./ui";

const Ctx = createContext<{ toggle: () => void; collapsed: boolean; status: React.ReactNode }>({ toggle: () => {}, collapsed: false, status: null });

/** App frame: collapsible sidebar on desktop (remembered in a cookie), slide-in drawer on phones. */
export function Shell({ sidebar, children, initialCollapsed, status = null }: { sidebar: React.ReactNode; children: React.ReactNode; initialCollapsed: boolean; status?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();
  const params = useSearchParams();
  useEffect(() => { setDrawer(false); }, [path, params]);
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
      <NavProgress />
      <div className="fixed inset-0 flex overflow-clip">
        <aside className={`${collapsed ? "md:hidden" : "md:flex"} hidden w-[264px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]`}>
          {sidebar}
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
            <button aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside className="relative flex h-full w-[280px] max-w-[85vw] flex-col bg-[var(--surface)] shadow-xl">{sidebar}</aside>
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-clip">{children}</div>
      </div>
    </Ctx.Provider>
  );
}

export function MenuButton() {
  const { toggle, collapsed } = useContext(Ctx);
  return (
    <button onClick={toggle} aria-label={collapsed ? "Show sidebar" : "Toggle sidebar"} title="Show / hide sidebar"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
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
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)]/80 px-3 backdrop-blur md:px-5">
        <MenuButton />
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold md:text-base">{title}</h1>
        <SyncStatus />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

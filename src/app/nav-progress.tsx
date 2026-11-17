"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Thin bar at the top that appears the instant you click any in-app link and disappears when the new screen is
 * ready, so navigation never looks frozen.
 */
export function NavProgress() {
  const path = usePathname();
  const sp = useSearchParams();
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [path, sp]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      setBusy(true);
    };
    const onSubmit = (e: SubmitEvent) => { const f = e.target as HTMLFormElement; if ((f.method || "get").toLowerCase() === "get" && !f.action.includes("/api/")) setBusy(true); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("ub:navigating", () => setBusy(true));
    return () => { document.removeEventListener("click", onClick, true); document.removeEventListener("submit", onSubmit, true); };
  }, []);
  useEffect(() => { if (!busy) return; const t = setTimeout(() => setBusy(false), 15000); return () => clearTimeout(t); }, [busy]);
  if (!busy) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden" role="progressbar" aria-label="Loading">
      <div className="ub-progress h-full w-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]" />
    </div>
  );
}

// Small presentational helpers (server-safe: no hooks).

const PALETTE = ["bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-lime-600", "bg-emerald-600", "bg-teal-600", "bg-sky-600", "bg-blue-600", "bg-indigo-600", "bg-violet-600", "bg-fuchsia-600", "bg-pink-600"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string) {
  const clean = name.replace(/<.*?>|["']/g, "").trim();
  const parts = clean.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Avatar({ name, size = "md", you = false }: { name: string; size?: "sm" | "md" | "lg"; you?: boolean }) {
  const dims = size === "sm" ? "h-7 w-7 text-[11px]" : size === "lg" ? "h-10 w-10 text-sm" : "h-9 w-9 text-xs";
  const color = you ? "bg-neutral-800 dark:bg-neutral-200 dark:text-neutral-900" : PALETTE[hash(name.toLowerCase()) % PALETTE.length];
  return (
    <span aria-hidden className={`inline-flex ${dims} shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${color}`}>
      {you ? "Me" : initials(name)}
    </span>
  );
}

export function ProviderIcon({ provider, className = "h-4 w-4" }: { provider?: string | null; className?: string }) {
  if (provider === "slack") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function Icon({ name, className = "h-4 w-4" }: { name: "menu" | "search" | "close" | "back" | "reply" | "replyAll" | "forward" | "external" | "inbox" | "check" | "spark" | "settings" | "plug"; className?: string }) {
  const p: Record<string, React.ReactNode> = {
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    back: <path d="M15 18l-6-6 6-6" />,
    reply: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 5 5v5" />,
    replyAll: <><path d="M11 14 6 9l5-5M6 9h9a5 5 0 0 1 5 5v5" /><path d="M7 14 2 9l5-5" /></>,
    forward: <path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0-5 5v5" />,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
    inbox: <><path d="M3 13h5l2 3h4l2-3h5" /><path d="M5 5h14l2 8v6H3v-6z" /></>,
    check: <path d="m5 12 5 5L20 7" />,
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
    plug: <path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4" />,
  };
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>;
}

export const statusDot: Record<string, string> = {
  connected: "bg-emerald-500", needs_reauth: "bg-amber-500", blocked_by_admin: "bg-red-500", error: "bg-red-500",
};
export const statusLabel: Record<string, string> = {
  needs_reauth: "Needs reconnect", blocked_by_admin: "Blocked by admin", error: "Sync error",
};

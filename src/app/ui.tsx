// Small presentational helpers (server-safe: no hooks).
import { BRAND_PATHS } from "./brand-paths";

const PALETTE = ["bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-lime-600", "bg-emerald-600", "bg-teal-600", "bg-sky-600", "bg-blue-600", "bg-indigo-600", "bg-violet-600", "bg-fuchsia-600", "bg-pink-600"];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string) {
  const clean = name.replace(/<.*?>|["']/g, "").trim();
  const parts = clean.replace(/\(.*?\)/g, " ").split(/[\s@._-]+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);
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
  const svg = (d: React.ReactNode) => (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
  );
  const brand = BRAND_PATHS[provider === "whatsapp_web" ? "whatsapp" : provider ?? ""];
  if (brand) return <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden><path d={brand} /></svg>;
  if (provider === "whatsapp" || provider === "whatsapp_web") return svg(<><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19.1z" /><path d="M9.5 9.5c0 2.5 2.5 5 5 5l1-1.5-2-1-1 .8a4 4 0 0 1-2.3-2.3l.8-1-1-2z" /></>);
  if (provider === "telegram") return svg(<path d="M21 4 3 11l6 2.2M21 4l-3 16-9-6.8M21 4 9 13.2V19l3-3.3" />);
  if (provider === "outlook" || provider === "teams") return svg(<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 9h18" /><path d="M8 13h3" /></>);
  if (provider === "sms") return svg(<><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M11 18h2" /></>);
  if (provider === "instagram") return svg(<><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></>);
  if (provider === "messenger" || provider === "google_chat" || provider === "discord" || provider === "upwork" || provider === "linkedin")
    return svg(<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" />);
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

export type IconName = "menu" | "search" | "close" | "back" | "reply" | "replyAll" | "forward" | "external" | "inbox" | "check" | "spark" | "settings" | "plug" | "logout"
  | "star" | "starFill" | "trash" | "clock" | "mail" | "mailOpen" | "pencil" | "chevron" | "chevronRight" | "sun" | "moon" | "monitor" | "users" | "more" | "plus" | "copy" | "shield" | "hash" | "chat";
export function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  const p: Record<string, React.ReactNode> = {
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    back: <path d="M15 18l-6-6 6-6" />,
    reply: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 5 5v5" />,
    hash: <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />,
    chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />,
    replyAll: <><path d="M11 14 6 9l5-5M6 9h9a5 5 0 0 1 5 5v5" /><path d="M7 14 2 9l5-5" /></>,
    forward: <path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0-5 5v5" />,
    external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
    inbox: <><path d="M3 13h5l2 3h4l2-3h5" /><path d="M5 5h14l2 8v6H3v-6z" /></>,
    check: <path d="m5 12 5 5L20 7" />,
    spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
    plug: <path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4" />,
    logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
    starFill: <path fill="currentColor" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
    trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>,
    mailOpen: <><path d="M3 10l9-6 9 6v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="m4 10 8 5 8-5" /></>,
    pencil: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
    chevron: <path d="m6 9 6 6 6-6" />,
    chevronRight: <path d="m9 6 6 6-6 6" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
    monitor: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></>,
    more: <><circle cx="5" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="19" cy="12" r="1.3" fill="currentColor" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
    shield: <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" />,
  };
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{p[name]}</svg>;
}

export const statusDot: Record<string, string> = {
  connected: "bg-emerald-500", needs_reauth: "bg-amber-500", blocked_by_admin: "bg-red-500", error: "bg-red-500",
};
export const statusLabel: Record<string, string> = {
  needs_reauth: "Needs reconnect", blocked_by_admin: "Blocked by admin", error: "Sync error",
};

/** Brand colour + short name for each channel, used for tags, avatars and the sidebar. */
export const CHANNEL: Record<string, { name: string; color: string; soft: string }> = {
  gmail: { name: "Gmail", color: "#EA4335", soft: "rgb(234 67 53 / 0.12)" },
  outlook: { name: "Outlook", color: "#0F6CBD", soft: "rgb(15 108 189 / 0.12)" },
  slack: { name: "Slack", color: "#A0418E", soft: "rgb(160 65 142 / 0.14)" },
  whatsapp: { name: "WhatsApp Business API", color: "#1FA855", soft: "rgb(31 168 85 / 0.13)" },
  whatsapp_web: { name: "WhatsApp", color: "#128C7E", soft: "rgb(18 140 126 / 0.13)" },
  imap: { name: "Email", color: "#6B5CE7", soft: "rgb(107 92 231 / 0.13)" },
  telegram: { name: "Telegram", color: "#229ED9", soft: "rgb(34 158 217 / 0.13)" },
  teams: { name: "Teams", color: "#5B5FC7", soft: "rgb(91 95 199 / 0.13)" },
  instagram: { name: "Instagram", color: "#D62976", soft: "rgb(214 41 118 / 0.12)" },
  messenger: { name: "Messenger", color: "#0084FF", soft: "rgb(0 132 255 / 0.12)" },
  linkedin: { name: "LinkedIn", color: "#0A66C2", soft: "rgb(10 102 194 / 0.12)" },
};
export const channel = (p?: string | null) => CHANNEL[p ?? ""] ?? { name: p ?? "Inbox", color: "#64708a", soft: "rgb(100 112 138 / 0.12)" };

/** "rafay.work@gmail.com" -> "rafay.work"; "@rafay" stays "@rafay". */
export const shortName = (n: string) => (n.indexOf("@") > 0 ? n.slice(0, n.indexOf("@")) : n.replace(/^@/, ""));

/** What people call an account: their nickname if set, else the short form of the address/workspace. */
export const accountName = (a: { label?: string | null; display_name: string }) => a.label?.trim() || a.display_name;

/** Rounded-square avatar for a connected account: initials on the channel colour, with the channel icon badge. */
export function ChannelAvatar({ provider, name, size = "md" }: { provider?: string | null; name: string; size?: "sm" | "md" }) {
  const c = channel(provider);
  const dims = size === "sm" ? "h-6 w-6 text-[10px] rounded-md" : "h-8 w-8 text-xs rounded-lg";
  return (
    <span aria-hidden className={`relative inline-flex ${dims} shrink-0 select-none items-center justify-center font-bold text-white`} style={{ background: c.color }}>
      {initials(shortName(name))}
    </span>
  );
}

/** Small coloured tag saying which channel + account a conversation came from. */
export function ChannelTag({ provider, label }: { provider?: string | null; label: string }) {
  const c = channel(provider);
  return (
    <span className="chip max-w-44 truncate" style={{ background: c.soft, color: c.color }} title={`${c.name} · ${label}`}>
      <ProviderIcon provider={provider} className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

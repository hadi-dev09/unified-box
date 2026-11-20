import { BRAND_PATHS } from "./brand-paths";

/** Slack's four-colour mark and Gmail's colour "M" (drawn here because Simple Icons no longer ships them in colour). */
const SlackMark = () => (
  <svg viewBox="0 0 122.8 122.8" className="h-[62%] w-[62%]" aria-hidden>
    <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a" />
    <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0" />
    <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d" />
    <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e" />
  </svg>
);
const GmailMark = () => (
  <svg viewBox="52 42 88 66" className="h-[58%] w-[58%]" aria-hidden>
    <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
    <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
    <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
    <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
    <path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
  </svg>
);
const Glyph = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" className="h-[56%] w-[56%]" fill="#fff" aria-hidden><path d={d} /></svg>;
const Letters = ({ t, size = 11 }: { t: string; size?: number }) => (
  <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]" aria-hidden><text x="12" y="16.2" textAnchor="middle" fontSize={size} fontWeight="800" fontFamily="Arial, Helvetica, sans-serif" fill="#fff">{t}</text></svg>
);
const OutlookMark = () => (
  <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" aria-hidden>
    <rect x="9" y="5" width="13" height="14" rx="1.5" fill="#fff" opacity=".35" />
    <path d="M9 8.5 15.5 13 22 8.5" stroke="#fff" strokeWidth="1.3" fill="none" opacity=".9" />
    <rect x="2" y="4" width="11" height="16" rx="2" fill="#fff" />
    <ellipse cx="7.5" cy="12" rx="3" ry="3.6" fill="none" stroke="#0a64c8" strokeWidth="2" />
  </svg>
);

const TILES: Record<string, { bg: string; mark: React.ReactNode }> = {
  gmail: { bg: "#ffffff", mark: <GmailMark /> },
  slack: { bg: "#ffffff", mark: <SlackMark /> },
  outlook: { bg: "linear-gradient(135deg,#1490df,#0a4fb0)", mark: <OutlookMark /> },
  whatsapp: { bg: "#25D366", mark: <Glyph d={BRAND_PATHS.whatsapp} /> },
  whatsapp_web: { bg: "#25D366", mark: <Glyph d={BRAND_PATHS.whatsapp} /> },
  telegram: { bg: "#229ED9", mark: <Glyph d={BRAND_PATHS.telegram} /> },
  instagram: { bg: "radial-gradient(circle at 30% 107%,#fdf497 0%,#fd5949 45%,#d6249f 60%,#285AEB 90%)", mark: <Glyph d={BRAND_PATHS.instagram} /> },
  messenger: { bg: "linear-gradient(45deg,#0099FF,#A033FF 60%,#FF5280 90%,#FF7061)", mark: <Glyph d={BRAND_PATHS.messenger} /> },
  linkedin: { bg: "#0A66C2", mark: <Letters t="in" size={12} /> },
  imap: { bg: "#6001D2", mark: <Letters t="Y!" size={11} /> },
  google_chat: { bg: "#00AC47", mark: <Glyph d={BRAND_PATHS.google_chat} /> },
  discord: { bg: "#5865F2", mark: <Glyph d={BRAND_PATHS.discord} /> },
  upwork: { bg: "#14A800", mark: <Glyph d={BRAND_PATHS.upwork} /> },
  teams: { bg: "#5059C9", mark: <Letters t="T" size={13} /> },
  sms: { bg: "#34C759", mark: <Letters t="SMS" size={7} /> },
};

/** The app's real logo on a rounded tile, like a phone home screen. */
export function BrandLogo({ provider, size = 36, className = "" }: { provider?: string | null; size?: number; className?: string }) {
  const t = TILES[provider ?? ""] ?? { bg: "#64748b", mark: <Letters t="@" size={12} /> };
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[28%] ring-1 ring-black/5 ${className}`}
      style={{ width: size, height: size, background: t.bg }}>
      {t.mark}
    </span>
  );
}

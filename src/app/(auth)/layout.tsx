import Link from "next/link";
import { CHANNEL, Icon, ProviderIcon } from "../ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#0b0d12] p-10 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-indigo-600/35 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-[-6rem] h-[28rem] w-[28rem] rounded-full bg-violet-600/30 blur-3xl" />
        <Link href="/" className="relative flex items-center gap-2.5 text-lg font-bold tracking-tight">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500"><Icon name="inbox" /></span>
          Unified Box
        </Link>
        <div className="relative mt-auto max-w-md">
          <div className="mb-8 flex flex-wrap gap-2">
            {["gmail", "outlook", "slack", "whatsapp", "telegram"].map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-sm ring-1 ring-white/15">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md" style={{ background: CHANNEL[p].color }}><ProviderIcon provider={p} className="h-3 w-3" /></span>{CHANNEL[p].name}
              </span>
            ))}
          </div>
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Every client conversation.<br /><span className="bg-gradient-to-r from-indigo-300 to-violet-300 bg-clip-text text-transparent">One calm inbox.</span></h2>
          <ul className="mt-8 space-y-4 text-white/75">
            {[
              ["inbox", "Email and chats side by side, grouped by client."],
              ["spark", "Ask Claude or ChatGPT what needs you today."],
              ["shield", "AI never sends on its own. You approve every message."],
            ].map(([icon, text]) => (
              <li key={text} className="flex gap-3"><span className="mt-0.5 text-white"><Icon name={icon as "inbox"} className="h-5 w-5" /></span>{text}</li>
            ))}
          </ul>
        </div>
        <p className="relative mt-10 text-xs text-white/45">Tokens encrypted · Revoke access any time</p>
      </aside>
      <main className="flex items-center justify-center bg-[var(--surface)] px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center gap-2 font-bold tracking-tight lg:hidden">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white"><Icon name="inbox" /></span>
            Unified Box
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}

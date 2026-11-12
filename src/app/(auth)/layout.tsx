import Link from "next/link";
import { Icon } from "../ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-neutral-950 p-10 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-blue-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-violet-600/25 blur-3xl" />
        <Link href="/" className="relative flex items-center gap-2 text-lg font-semibold">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-neutral-900"><Icon name="inbox" /></span>
          Unified Box
        </Link>
        <div className="relative mt-auto max-w-md">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">Every client conversation.<br />One calm inbox.</h2>
          <ul className="mt-8 space-y-4 text-neutral-300">
            {[
              ["inbox", "Gmail and Slack accounts side by side, grouped by client."],
              ["spark", "Ask Claude, ChatGPT, Gemini or Grok what needs your attention."],
              ["check", "AI drafts never send on their own. You approve every message."],
            ].map(([icon, text]) => (
              <li key={text} className="flex gap-3"><span className="mt-0.5 text-white"><Icon name={icon as "inbox"} className="h-5 w-5" /></span>{text}</li>
            ))}
          </ul>
        </div>
        <p className="relative mt-10 text-xs text-neutral-500">Read-only by default · Tokens encrypted · Revoke access anytime</p>
      </aside>
      <main className="flex items-center justify-center bg-white px-4 py-10 dark:bg-neutral-900 sm:px-8">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center gap-2 font-semibold lg:hidden">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"><Icon name="inbox" /></span>
            Unified Box
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { Avatar, Icon, ProviderIcon } from "./ui";

const FEATURES: { icon: "inbox" | "spark" | "check" | "plug" | "settings" | "search"; title: string; body: string }[] = [
  { icon: "inbox", title: "Every inbox in one place", body: "Connect several Gmail accounts and Slack workspaces. Read everything from one screen on your laptop or phone." },
  { icon: "plug", title: "Grouped by client", body: "Tag conversations by client automatically by sender or domain, across every account." },
  { icon: "spark", title: "Works with your AI", body: "Connect Claude, ChatGPT, Grok or Gemini and ask “what needs a reply today?” across all inboxes." },
  { icon: "check", title: "You approve every send", body: "AI can draft replies, but nothing leaves without your OK. Edit, approve or reject in one tap." },
  { icon: "search", title: "Find anything fast", body: "Search senders, subjects and previews across all accounts at once." },
  { icon: "settings", title: "Private by design", body: "Read-only by default, encrypted tokens, and one-click disconnect that also revokes access." },
];

export function Landing() {
  return (
    <div className="min-h-dvh bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"><Icon name="inbox" /></span>
          Unified Box
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/login" className="rounded-lg px-3 py-2 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800">Sign in</Link>
          <Link href="/signup" className="rounded-lg bg-neutral-900 px-3 py-2 font-semibold text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900">Get started</Link>
        </nav>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-b from-blue-500/15 via-violet-500/10 to-transparent blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-12 text-center md:px-6 md:pt-20">
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> For freelancers, agencies and busy managers
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl">Stop juggling five inboxes before breakfast.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-neutral-600 dark:text-neutral-400">Unified Box brings your Gmail accounts and Slack workspaces into one fast inbox, grouped by client, and lets your AI assistant read and draft for you, with you approving every send.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="rounded-xl bg-neutral-900 px-5 py-3 font-semibold text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900">Create free account</Link>
            <Link href="/login" className="rounded-xl border border-neutral-300 px-5 py-3 font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">Sign in</Link>
          </div>

          {/* product preview */}
          <div className="mx-auto mt-14 max-w-4xl overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 text-left shadow-2xl shadow-neutral-900/10 dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex items-center gap-1.5 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <span className="h-3 w-3 rounded-full bg-red-400" /><span className="h-3 w-3 rounded-full bg-amber-400" /><span className="h-3 w-3 rounded-full bg-emerald-400" />
            </div>
            <div className="grid md:grid-cols-[200px_1fr]">
              <div className="hidden space-y-1 border-r border-neutral-200 p-3 text-sm dark:border-neutral-800 md:block">
                <div className="rounded-lg bg-neutral-900 px-2.5 py-1.5 text-white dark:bg-white dark:text-neutral-900">All inboxes</div>
                {[["gmail", "work@gmail.com"], ["gmail", "billing@client.io"], ["slack", "Client workspace"]].map(([p, n]) => (
                  <div key={n} className="flex items-center gap-2 px-2.5 py-1.5 text-neutral-600 dark:text-neutral-400"><ProviderIcon provider={p} />{n}</div>
                ))}
              </div>
              <ul className="divide-y divide-neutral-200/70 dark:divide-neutral-800">
                {[["Sarah Mitchell", "Q4 deliverables: need your sign-off", "Greenbridge", true], ["Daniel Okafor", "Contract renewal, any changes?", "Acme", true], ["Priya Nair", "Question about API limits", "Greenbridge", false]].map(([who, subj, client, reply]) => (
                  <li key={String(who)} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={String(who)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{who}</p>
                      <p className="truncate text-sm text-neutral-500">{subj}</p>
                    </div>
                    <span className="hidden rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200 sm:inline">{client}</span>
                    {reply && <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">Reply</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 md:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-neutral-200 p-5 dark:border-neutral-800">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800"><Icon name={f.icon} className="h-5 w-5" /></span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">{f.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-neutral-500">Gmail and Slack today · WhatsApp Business, Upwork and Telegram on the roadmap</p>
      </section>

      <footer className="border-t border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-neutral-500 md:px-6">
          <span>© {new Date().getFullYear()} Unified Box</span>
          <nav className="flex gap-4"><Link href="/privacy" className="hover:text-neutral-900 dark:hover:text-white">Privacy</Link><Link href="/terms" className="hover:text-neutral-900 dark:hover:text-white">Terms</Link></nav>
        </div>
      </footer>
    </div>
  );
}

import Link from "next/link";
import { Avatar, CHANNEL, ChannelTag, Icon, ProviderIcon, type IconName } from "./ui";

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: "inbox", title: "Every channel, one inbox", body: "Gmail, Outlook, Slack, WhatsApp Business and Telegram side by side, on laptop and phone." },
  { icon: "users", title: "Grouped by client", body: "Conversations tag themselves by sender or domain, across every account and app." },
  { icon: "spark", title: "Works with your AI", body: "Ask Claude or ChatGPT “what needs a reply today?” and get drafts ready to send." },
  { icon: "shield", title: "You stay in control", body: "AI never sends or deletes. Tokens are encrypted and one click disconnects anything." },
  { icon: "clock", title: "Snooze, star, clean up", body: "Snooze until tomorrow, star what matters, clear many conversations at once." },
  { icon: "search", title: "Find anything instantly", body: "Search every inbox at once, with results as you type." },
];

const PREVIEW = [
  { who: "Sarah Mitchell", subject: "Q4 deliverables: sign-off by Friday", p: "gmail", acct: "Work", unread: true, client: "Acme" },
  { who: "#client-greenbridge", subject: "Dana: deploy looks good, ship it?", p: "slack", acct: "Greenbridge", unread: true, client: "Greenbridge" },
  { who: "Omar (Client)", subject: "Can we move tomorrow's call to 4pm?", p: "telegram", acct: "@rafay", unread: false },
  { who: "Priya Nair", subject: "Invoice #1042 is ready", p: "whatsapp", acct: "Studio", unread: false, client: "Greenbridge" },
];

export function Landing() {
  return (
    <div className="min-h-dvh bg-[var(--bg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)]/60 bg-[var(--bg)]/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white"><Icon name="inbox" /></span>
            Unified Box
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/login" className="rounded-xl px-3 py-2 font-medium hover:bg-[var(--surface-2)]">Sign in</Link>
            <Link href="/signup" className="btn-primary">Get started</Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-[-120px] h-[520px] w-[1000px] -translate-x-1/2 rounded-full bg-gradient-to-b from-indigo-500/20 via-violet-500/10 to-transparent blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 text-center md:px-6 md:pt-24">
          <div className="mx-auto mb-6 flex flex-wrap justify-center gap-2">
            {["gmail", "outlook", "slack", "whatsapp", "telegram"].map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-3 py-1 text-xs font-medium shadow-[var(--shadow)] ring-1 ring-[var(--border)]">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded text-white" style={{ background: CHANNEL[p].color }}><ProviderIcon provider={p} className="h-2.5 w-2.5" /></span>{CHANNEL[p].name}
              </span>
            ))}
          </div>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight md:text-6xl">
            All your client conversations. <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] bg-clip-text text-transparent">One inbox.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg muted">Stop switching between Gmail tabs, Slack workspaces and WhatsApp. Unified Box puts everything in one fast inbox, grouped by client, and works with your AI assistant.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="btn-primary !rounded-xl !px-6 !py-3 !text-base">Create free account</Link>
            <Link href="/login" className="btn !rounded-xl !px-6 !py-3 !text-base">Sign in</Link>
          </div>

          <div className="card mx-auto mt-14 max-w-4xl overflow-hidden text-left shadow-[var(--shadow-lg)]">
            <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-red-400" /><span className="h-3 w-3 rounded-full bg-amber-400" /><span className="h-3 w-3 rounded-full bg-emerald-400" />
              <span className="ml-3 rounded-lg bg-[var(--surface-2)] px-3 py-1 text-xs muted">Search messages, people, channels</span>
            </div>
            <div className="grid md:grid-cols-[210px_1fr]">
              <div className="hidden space-y-1 border-r border-[var(--border)] p-3 text-sm md:block">
                <div className="flex items-center gap-2 rounded-xl bg-[var(--accent-soft)] px-2.5 py-1.5 font-semibold text-[var(--accent-text)]"><Icon name="inbox" /> All inboxes <span className="ml-auto rounded-full bg-[var(--accent)] px-1.5 text-[11px] text-white">4</span></div>
                {["gmail", "slack", "whatsapp", "telegram"].map((p) => (
                  <div key={p} className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md text-white" style={{ background: CHANNEL[p].color }}><ProviderIcon provider={p} className="h-3 w-3" /></span>{CHANNEL[p].name}
                  </div>
                ))}
              </div>
              <ul className="space-y-1 p-2">
                {PREVIEW.map((r) => (
                  <li key={r.subject} className={`relative flex items-start gap-3 rounded-xl py-2.5 pl-4 pr-3 ${r.unread ? "bg-[var(--surface)] ring-1 ring-[var(--border)]" : ""}`}>
                    {r.unread && <span className="absolute inset-y-3 left-1 w-1 rounded-full bg-[var(--unread)]" />}
                    <Avatar name={r.who} />
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm ${r.unread ? "font-bold" : "font-medium"}`}>{r.who}</div>
                      <div className="truncate text-sm muted">{r.subject}</div>
                      <div className="mt-1.5 flex gap-1.5"><ChannelTag provider={r.p} label={r.acct} />{r.client && <span className="chip bg-violet-500/12 text-violet-700 dark:text-violet-300">{r.client}</span>}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 md:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><Icon name={f.icon} className="h-5 w-5" /></span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm muted">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-14 overflow-hidden rounded-3xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] p-8 text-center text-white md:p-12">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Get to inbox zero across every app</h2>
          <p className="mx-auto mt-2 max-w-xl text-white/85">Connect your first inbox in under a minute. Free while in beta.</p>
          <Link href="/signup" className="mt-6 inline-flex rounded-xl bg-white px-6 py-3 font-semibold text-indigo-700 hover:bg-white/90">Create free account</Link>
        </div>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 text-sm muted">
          <span>© {new Date().getFullYear()} Unified Box</span>
          <span className="flex gap-4"><Link href="/privacy" className="hover:text-[var(--text)]">Privacy</Link><Link href="/terms" className="hover:text-[var(--text)]">Terms</Link></span>
        </footer>
      </section>
    </div>
  );
}

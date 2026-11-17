import { currentUser } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "../../shell";
import { supabaseServer } from "@/lib/supabase/server";
import { LocalTime } from "../../local-time";
import { accountName, ChannelTag, Icon, shortName } from "../../ui";

type Draft = {
  id: string; thread_id: string | null; to_addrs: string[]; subject: string; body: string; status: string; created_by: string; error: string | null; created_at: string;
  accounts: { display_name: string; label: string | null; provider: string } | null; threads: { subject: string | null; last_from: string | null } | null;
};

/** Drafts your AI assistant wrote. Open one to see it inside its conversation, edit, and send (or discard). */
export default async function Approvals({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const sb = await supabaseServer();
  const show = (await searchParams).show === "history" ? "history" : "pending";
  let q = sb.from("drafts").select("id, thread_id, to_addrs, subject, body, status, created_by, error, created_at, accounts(display_name, label, provider), threads(subject, last_from)").order("created_at", { ascending: false }).limit(60);
  q = show === "pending" ? q.eq("status", "pending") : q.neq("status", "pending");
  const drafts = ((await q).data ?? []) as unknown as Draft[];
  const tab = (k: string, label: string) => (
    <Link href={k === "pending" ? "/approvals" : "/approvals?show=history"} className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${show === k ? "bg-[var(--text)] text-[var(--bg)]" : "muted hover:bg-[var(--surface-2)]"}`}>{label}</Link>
  );
  const statusChip: Record<string, string> = { sent: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", rejected: "bg-[var(--surface-2)] muted", failed: "bg-red-500/12 text-red-700 dark:text-red-300", approved: "bg-sky-500/12 text-sky-700" };

  return (
    <PageFrame title="AI drafts">
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 md:px-6">
      <div className="card mb-5 flex gap-3 p-4">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-300"><Icon name="spark" /></span>
        <p className="text-sm muted">When you ask Claude, ChatGPT or another assistant to <b className="text-[var(--text)]">write a reply</b>, it lands here and inside the conversation, and it is <b className="text-[var(--text)]">never sent until you press Send</b>. Open a draft to read the conversation, tweak the text and send it in one place. Replies you write yourself send straight away.</p>
      </div>
      <div className="mb-3 flex gap-1">{tab("pending", "Waiting for you")}{tab("history", "History")}</div>
      {drafts.length === 0 && (
        <div className="card p-8 text-center">
          <p className="font-semibold">{show === "pending" ? "No drafts waiting" : "No history yet"}</p>
          <p className="mt-1 text-sm muted">Try asking your assistant: “Draft a reply to the latest email that needs a response.”</p>
        </div>
      )}
      <ul className="space-y-2">
        {drafts.map((d) => {
          const href = d.thread_id ? `/?thread=${d.thread_id}&draft=${d.id}` : null;
          const inner = (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs muted">
                {d.accounts && <ChannelTag provider={d.accounts.provider} label={shortName(accountName(d.accounts))} />}
                <span>{d.created_by === "claude" ? "Written by your AI" : "Written by you"}</span>
                <span>·</span><LocalTime iso={d.created_at} />
                {d.status !== "pending" && <span className={`chip ${statusChip[d.status] ?? ""}`}>{d.status}</span>}
              </div>
              <p className="mt-1.5 truncate font-semibold">{d.threads?.subject || d.subject}</p>
              <p className="truncate text-xs muted">{d.to_addrs.length ? `To ${d.to_addrs.join(", ")}` : `Reply to ${d.threads?.last_from ?? "the chat"}`}</p>
              <p className="mt-2 line-clamp-2 text-sm text-[var(--text)]/80">{d.body}</p>
              {d.error && <p className="mt-2 text-xs text-red-600">{d.error}</p>}
            </>
          );
          return (
            <li key={d.id}>
              {href ? (
                <Link href={href} className="card group block p-4 transition hover:border-[var(--border-strong)]">
                  {inner}
                  {d.status === "pending" && <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--accent-text)]">Review &amp; send in conversation <Icon name="chevronRight" className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>}
                </Link>
              ) : <div className="card p-4">{inner}</div>}
            </li>
          );
        })}
      </ul>
    </main>
    </PageFrame>
  );
}

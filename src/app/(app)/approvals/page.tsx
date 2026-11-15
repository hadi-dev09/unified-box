import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "../../shell";
import { supabaseServer } from "@/lib/supabase/server";
import { DraftActions } from "./draft-actions";

export default async function Approvals() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: drafts } = await sb.from("drafts").select("id, to_addrs, subject, body, status, created_by, error, accounts(display_name)").order("created_at", { ascending: false }).limit(50);
  return (
    <PageFrame title="AI drafts">
    <main className="mx-auto max-w-2xl px-4 py-6 md:py-8">
      <h1 className="my-3 text-2xl font-semibold tracking-tight">AI drafts</h1>
      <p className="mb-4 text-sm text-neutral-500">Replies written by your AI assistant (Claude, ChatGPT, …) wait here. Nothing an AI writes is sent until you approve it. Replies you write yourself send immediately.</p>
      {(drafts ?? []).length === 0 && <p className="text-sm text-neutral-500">No AI drafts. Ask your assistant to draft a reply and it will appear here, and inside the conversation.</p>}
      {(drafts ?? []).map((d) => (
        <article key={d.id} className="mb-3 rounded-xl bg-white p-3 ring-1 ring-neutral-200/70 dark:bg-neutral-900 dark:ring-neutral-800">
          <div className="text-xs text-neutral-500">From {(d.accounts as unknown as { display_name: string } | null)?.display_name} → {d.to_addrs.join(", ")} · {d.created_by === "claude" ? "written by AI" : "written by you"} · {d.status}</div>
          {d.status === "pending" ? (
            <DraftActions id={d.id} subject={d.subject} body={d.body} />
          ) : (
            <>
              <div className="mt-1 font-medium">{d.subject}</div>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{d.body}</pre>
            </>
          )}
          {d.error && <div className="mt-2 text-xs text-red-600">{d.error}</div>}
        </article>
      ))}
    </main>
    </PageFrame>
  );
}

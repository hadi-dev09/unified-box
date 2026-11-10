import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { DraftActions } from "./draft-actions";

export default async function Approvals() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: drafts } = await sb.from("drafts").select("id, to_addrs, subject, body, status, created_by, error, accounts(display_name)").order("created_at", { ascending: false }).limit(50);
  return (
    <main className="mx-auto max-w-xl p-4">
      <Link href="/" className="text-sm text-blue-600">← Inbox</Link>
      <h1 className="my-3 text-xl font-semibold">Approvals</h1>
      <p className="mb-4 text-sm text-neutral-500">Nothing is sent until you approve it here.</p>
      {(drafts ?? []).length === 0 && <p className="text-sm text-neutral-500">No drafts.</p>}
      {(drafts ?? []).map((d) => (
        <article key={d.id} className="mb-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
          <div className="text-xs text-neutral-500">From {(d.accounts as unknown as { display_name: string } | null)?.display_name} → {d.to_addrs.join(", ")} · by {d.created_by} · {d.status}</div>
          <div className="mt-1 font-medium">{d.subject}</div>
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">{d.body}</pre>
          {d.error && <div className="mt-2 text-xs text-red-600">{d.error}</div>}
          {d.status === "pending" && <DraftActions id={d.id} />}
        </article>
      ))}
    </main>
  );
}

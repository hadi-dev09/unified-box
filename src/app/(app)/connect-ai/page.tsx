import { currentUser } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "../../shell";
import { revalidatePath } from "next/cache";
import { revokeApiToken } from "@/lib/api-tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { LocalTime } from "../../local-time";
import { Icon } from "../../ui";
import { ConnectButton } from "./connect-button";
import { CopyButton } from "./copy-button";

async function uid() {
  const user = await currentUser();
  return user?.id ?? null;
}
async function revokeKey(form: FormData) {
  "use server";
  const u = await uid();
  if (u) await revokeApiToken(u, String(form.get("id") ?? ""));
  revalidatePath("/connect-ai");
}
async function revokeApp(form: FormData) {
  "use server";
  const u = await uid();
  if (!u) return;
  await supabaseAdmin().from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", u).eq("client_id", String(form.get("client_id") ?? "")).is("revoked_at", null);
  revalidatePath("/connect-ai");
}

export default async function ConnectAI() {
  const u = await uid();
  if (!u) redirect("/login?next=/connect-ai");
  const url = `${process.env.APP_URL ?? ""}/api/mcp`;
  const db = supabaseAdmin();
  const [{ data: keys }, { data: grants }, { data: recent }] = await Promise.all([
    db.from("api_tokens").select("id, name, prefix, created_at, last_used_at").eq("user_id", u).is("revoked_at", null).order("created_at", { ascending: false }),
    db.from("oauth_tokens").select("client_id, created_at, oauth_clients(client_name)").eq("user_id", u).eq("kind", "refresh").is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
    db.from("audit_log").select("created_at").eq("user_id", u).eq("actor", "claude").order("created_at", { ascending: false }).limit(1),
  ]);
  const apps = [...new Map((grants ?? []).map((g) => [g.client_id, { name: (g.oauth_clients as unknown as { client_name: string } | null)?.client_name ?? "AI app", since: g.created_at as string }])).entries()];
  const claudeLink = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent("Unified Box")}&connectorUrl=${encodeURIComponent(url)}`;
  const can = ["Read your conversations", "Search and summarise", "Organise: client groups, read/unread, star, snooze, rename channels", "Draft replies for you to approve"];
  const cannot = ["Send anything on its own", "Delete or trash messages", "See your passwords or tokens"];

  return (
    <PageFrame title="Connect your AI">
    <main className="mx-auto max-w-3xl space-y-6 px-4 pb-16 pt-6 md:px-6">
      <section className="card overflow-hidden">
        <div className="bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] p-5 text-white md:p-6">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Use Unified Box from your AI</h1>
          <p className="mt-1 text-sm text-white/85">Connect once, then ask things like “what needs my reply today?” or “draft a reply to Sarah”.</p>
        </div>
        <div className="p-4 md:p-5">
          <p className="text-xs font-semibold uppercase tracking-wider muted">Connector URL</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-[var(--surface-2)] px-3 py-2.5 font-mono text-sm">{url}</code>
            <CopyButton text={url} />
          </div>
          <p className="mt-2 text-xs muted">Works with any AI app that supports custom connectors (MCP). You&apos;ll sign in and approve on a Unified Box screen.</p>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="card flex flex-col p-5">
          <div className="flex items-center gap-2"><h2 className="font-semibold">Claude</h2><span className="chip bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">One click</span></div>
          <p className="mt-1 flex-1 text-sm muted">Opens Claude with Unified Box filled in. Click Add, then Approve.</p>
          <div className="mt-4"><ConnectButton href={claudeLink} label="Connect Claude" primary /></div>
        </div>
        <div className="card flex flex-col p-5">
          <div className="flex items-center gap-2"><h2 className="font-semibold">ChatGPT</h2><span className="chip bg-sky-500/12 text-sky-700 dark:text-sky-300">3 steps</span></div>
          <ol className="mt-2 flex-1 list-decimal space-y-1 pl-4 text-sm muted">
            <li>Settings → Apps → Advanced: turn on <b className="text-[var(--text)]">Developer mode</b></li>
            <li>Create app → paste the URL (copied by the button) → Authentication: OAuth</li>
            <li>Sign in and Approve. In a chat, pick Unified Box under + → More</li>
          </ol>
          <p className="mt-3 text-xs muted">ChatGPT has no one-click link for connectors yet. One-click arrives once Unified Box is approved in ChatGPT&apos;s app directory.</p>
          <div className="mt-3"><ConnectButton href="https://chatgpt.com/#settings/Connectors" label="Copy URL & open ChatGPT" copyText={url} /></div>
        </div>
      </section>
      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Gemini, Grok, Cursor and others</summary>
        <p className="mt-2 text-sm muted">Add a custom connector (MCP) in the app&apos;s settings and paste the URL above. You&apos;ll be sent here to sign in and approve. Grok supports this on paid plans; Gemini is rolling it out gradually; DeepSeek&apos;s app doesn&apos;t support connectors yet.</p>
      </details>

      <section className="card p-4 md:p-5">
        <h2 className="font-semibold">Connected assistants</h2>
        {apps.length === 0 ? <p className="mt-2 text-sm muted">None yet. Connect one above.</p> : (
          <ul className="mt-3 space-y-2">
            {apps.map(([id, a]) => (
              <li key={id} className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--surface-2)] px-3 py-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-xs font-bold text-white">{a.name.slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{a.name}</p>{a.since && <p className="text-xs muted">Connected <LocalTime iso={a.since} /></p>}</div>
                <form action={revokeApp}><input type="hidden" name="client_id" value={id} /><button className="btn !py-1.5 !text-xs !text-red-600">Disconnect</button></form>
              </li>
            ))}
          </ul>
        )}
        {recent?.[0] && <p className="mt-3 text-xs muted">Last AI activity <LocalTime iso={recent[0].created_at} mode="full" /></p>}
        <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
          <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wider muted">Your AI can</p><ul className="space-y-1 text-sm">{can.map((c) => <li key={c} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{c}</li>)}</ul></div>
          <div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wider muted">It can never</p><ul className="space-y-1 text-sm">{cannot.map((c) => <li key={c} className="flex gap-2"><Icon name="close" className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />{c}</li>)}</ul></div>
        </div>
      </section>

      {(keys ?? []).length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Older access keys</h2>
          <p className="mt-1 text-xs muted">Keys are no longer needed (assistants sign in instead). Revoke any you don&apos;t use.</p>
          <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
            {(keys ?? []).map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-2 py-2">
                <span>{k.name} <span className="font-mono text-xs muted">{k.prefix}…</span></span>
                <form action={revokeKey}><input type="hidden" name="id" value={k.id} /><button className="text-xs font-medium text-red-600 hover:underline">Revoke</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
    </PageFrame>
  );
}

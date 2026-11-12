import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createApiToken, revokeApiToken } from "@/lib/api-tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { LocalTime } from "../local-time";
import { Icon } from "../ui";
import { ConnectButton } from "./connect-button";
import { CopyButton } from "./copy-button";
import { NewKey } from "./new-key";

async function uid() {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  return user?.id ?? null;
}
async function createKey(name: string) {
  "use server";
  const u = await uid();
  if (!u) return { error: "Please sign in again" };
  return createApiToken(u, String(name ?? ""));
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

type Guide = { name: string; status: "works" | "limited" | "key"; steps: React.ReactNode[]; note?: string; action?: { href: string; label: string; copy?: boolean; primary?: boolean } };

export default async function ConnectAI() {
  const u = await uid();
  if (!u) redirect("/login?next=/connect-ai");
  const url = `${process.env.APP_URL ?? ""}/api/mcp`;
  const db = supabaseAdmin();
  const [{ data: keys }, { data: grants }] = await Promise.all([
    db.from("api_tokens").select("id, name, prefix, created_at, last_used_at").eq("user_id", u).is("revoked_at", null).order("created_at", { ascending: false }),
    db.from("oauth_tokens").select("client_id, created_at, oauth_clients(client_name)").eq("user_id", u).eq("kind", "refresh").is("revoked_at", null).gt("expires_at", new Date().toISOString()),
  ]);
  const apps = [...new Map((grants ?? []).map((g) => [g.client_id, (g.oauth_clients as unknown as { client_name: string } | null)?.client_name ?? "AI app"])).entries()];

  const claudeLink = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=${encodeURIComponent("Unified Box")}&connectorUrl=${encodeURIComponent(url)}`;
  const guides: Guide[] = [
    { name: "Claude", status: "works", action: { href: claudeLink, label: "Connect to Claude", primary: true },
      steps: ["Click Connect: Claude opens with Unified Box already filled in", "Click Add in Claude", "Approve on the Unified Box screen. Done"],
      note: "Team/Enterprise: an organization Owner adds it once, then each member connects." },
    { name: "ChatGPT", status: "works", action: { href: "https://chatgpt.com/#settings/Connectors", label: "Copy URL & open ChatGPT", copy: true },
      steps: ["Settings → Apps & Connectors → Advanced → turn on Developer mode", "Create a connector, paste the URL (already copied), choose OAuth", "Approve on the Unified Box screen"],
      note: "Developer mode depends on your ChatGPT plan; Business/Enterprise admins must enable it." },
    { name: "Grok", status: "works", action: { href: "https://grok.com/connectors", label: "Copy URL & open Grok", copy: true },
      steps: ["New connector → Custom", "Paste the URL (already copied)", "Approve on the Unified Box screen (paid Grok plans)"],
      note: "For the xAI API, use an access key below as the Authorization header." },
    { name: "Gemini", status: "limited", action: { href: "https://gemini.google.com/app", label: "Copy URL & open Gemini", copy: true },
      steps: ["Settings → Connected apps → Add a custom app", "Paste the URL (already copied) and sign in", "Approve on the Unified Box screen"],
      note: "Google is rolling this out gradually (reported: US, English, Keep Activity on, some plans)." },
    { name: "DeepSeek & others", status: "key",
      steps: ["DeepSeek's app doesn't support connectors yet", "Use an MCP-capable tool (Cursor, Claude Code, Codex, DeepSeek harness) with the server URL", "Create an access key below and set header Authorization: Bearer <key>"] },
  ];

  const pill: Record<Guide["status"], string> = {
    works: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    limited: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    key: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  };
  const pillText = { works: "Sign-in", limited: "Limited rollout", key: "Access key" };
  const card = "rounded-2xl bg-white p-4 ring-1 ring-neutral-200/70 dark:bg-neutral-900 dark:ring-neutral-800 md:p-5";

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 md:py-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"><Icon name="back" /> Inbox</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect your AI</h1>
        <p className="mt-1 text-sm text-neutral-500">Pick your assistant and click Connect. You&apos;ll approve once on a Unified Box screen. Assistants can read your inboxes and draft replies, but never send or delete: drafts wait for you in Approvals.</p>
      </div>

      <section className={card}>
        <p className="text-sm font-medium">Server URL</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-neutral-100 px-3 py-2 font-mono text-sm dark:bg-neutral-800">{url}</code>
          <CopyButton text={url} />
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {guides.map((g) => (
          <div key={g.name} className={`${card} flex flex-col`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{g.name}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${pill[g.status]}`}>{pillText[g.status]}</span>
            </div>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-neutral-700 dark:text-neutral-300">
              {g.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            {g.note && <p className="mt-3 text-xs text-neutral-500">{g.note}</p>}
            {g.action && <div className="mt-auto pt-4"><ConnectButton href={g.action.href} label={g.action.label} copyText={g.action.copy ? url : undefined} primary={g.action.primary} /></div>}
          </div>
        ))}
      </section>

      <section className={card}>
        <h2 className="font-semibold">Connected assistants</h2>
        <ul className="mt-3 divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
          {apps.length === 0 && <li className="py-2 text-neutral-500">None yet.</li>}
          {apps.map(([id, name]) => (
            <li key={id} className="flex items-center justify-between py-2">
              <span>{name}</span>
              <form action={revokeApp}><input type="hidden" name="client_id" value={id} /><button className="text-sm text-red-600 hover:underline">Revoke</button></form>
            </li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="font-semibold">Access keys</h2>
        <p className="mb-3 mt-1 text-sm text-neutral-500">For tools that can&apos;t show a sign-in screen. Send as <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">Authorization: Bearer &lt;key&gt;</code>. Same read + draft-only access. Treat keys like passwords.</p>
        <NewKey create={createKey} />
        <ul className="mt-4 divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
          {(keys ?? []).map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <div className="font-medium">{k.name} <span className="font-mono text-xs text-neutral-500">{k.prefix}…</span></div>
                <div className="text-xs text-neutral-500">Created <LocalTime iso={k.created_at} /> · {k.last_used_at ? <>last used <LocalTime iso={k.last_used_at} /></> : "never used"}</div>
              </div>
              <form action={revokeKey}><input type="hidden" name="id" value={k.id} /><button className="text-sm text-red-600 hover:underline">Revoke</button></form>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

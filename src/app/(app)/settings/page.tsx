import { currentUser } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "../../shell";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { disconnectAccount } from "@/lib/accounts";
import { addRule, createClientRecord, deleteClientRecord, deleteRule } from "@/lib/clients";
import { supabaseServer } from "@/lib/supabase/server";
import { slackConfigured } from "@/lib/slack";
import { ConfirmSubmit } from "./confirm-submit";
import { TelegramForm, WhatsAppForm } from "./connect-forms";
import { isConfigured, provider as providerInfo, PROVIDERS } from "@/lib/providers";
import { accountName, channel, ChannelAvatar, Icon, ProviderIcon } from "../../ui";
import { RenameAccount } from "./rename-account";
import { gmailHasScope, MODIFY_SCOPE } from "@/lib/gmail";

async function userId() {
  const user = await currentUser();
  return user?.id ?? null;
}
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

async function addClient(form: FormData) {
  "use server";
  const u = await userId();
  if (u) await createClientRecord(u, str(form, "name"));
  revalidatePath("/settings"); revalidatePath("/");
}
async function removeClient(form: FormData) {
  "use server";
  const u = await userId();
  if (u) await deleteClientRecord(u, str(form, "client_id"));
  revalidatePath("/settings"); revalidatePath("/");
}
async function addClientRule(form: FormData) {
  "use server";
  const u = await userId();
  const kind = str(form, "kind") === "email" ? "email" : "domain";
  if (u) await addRule(u, str(form, "client_id"), kind, str(form, "pattern"));
  revalidatePath("/settings"); revalidatePath("/");
}
async function removeRule(form: FormData) {
  "use server";
  const u = await userId();
  if (u) await deleteRule(u, str(form, "rule_id"));
  revalidatePath("/settings");
}

async function disconnect(form: FormData) {
  "use server";
  const user = await currentUser();
  if (!user) return;
  await disconnectAccount(user.id, String(form.get("account_id") ?? ""));
  revalidatePath("/settings");
  revalidatePath("/");
}

async function revoke(form: FormData) {
  "use server";
  const user = await currentUser();
  if (!user) return;
  const clientId = String(form.get("client_id") ?? "");
  const db = supabaseAdmin();
  await db.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", user.id).eq("client_id", clientId).is("revoked_at", null);
  await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "oauth.revoked", target: clientId });
  revalidatePath("/settings");
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sb = await supabaseServer();
  const user = await currentUser();
  if (!user) redirect("/login");
  const { msg } = await searchParams;
  const [{ data: accountRows }, { data: clientRows }, { data: ruleRows, error: rulesErr }] = await Promise.all([
    sb.from("accounts").select("id, provider, display_name, label, account_type, status, status_detail, can_send").order("provider"),
    sb.from("clients").select("id, name").order("name"),
    sb.from("client_rules").select("id, client_id, kind, pattern").order("pattern"),
  ]);
  const accounts = (accountRows ?? []) as { id: string; provider: string; display_name: string; label: string | null; account_type: string; status: string; status_detail: string | null; can_send: boolean }[];
  const manage = Object.fromEntries(await Promise.all(accounts.filter((a) => a.provider === "gmail").map(async (a) => [a.id, await gmailHasScope(a.id, MODIFY_SCOPE)] as const)));
  const clients = (clientRows ?? []) as { id: string; name: string }[];
  const rules = (ruleRows ?? []) as { id: string; client_id: string; kind: string; pattern: string }[];
  const live = PROVIDERS.filter((p) => p.stage === "live");
  const connectHref = (id: string, write: boolean) => id === "slack" ? `/api/connect/slack${write ? "?write=1" : ""}` : `/api/connect/${id}${write ? "?write=1" : ""}`;
  const section = "mb-3 mt-10 flex items-end justify-between gap-3";
  const perm = (on: boolean, label: string) => (
    <span className={`chip ${on ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-[var(--surface-2)] muted"}`}>{on ? <Icon name="check" className="h-3 w-3" /> : null}{label}</span>
  );

  return (
    <PageFrame title="Settings">
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 md:px-6">
      {msg && <p role="status" className="mb-4 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-sm font-medium text-[var(--accent-text)]">{msg}</p>}

      {/* ---------- connected ---------- */}
      <div className={section + " !mt-2"}>
        <div><h2 className="text-lg font-semibold tracking-tight">Your channels</h2><p className="text-sm muted">Rename them to whatever you remember them by, such as a client&apos;s name.</p></div>
      </div>
      <ul className="space-y-2">
        {accounts.length === 0 && <li className="card p-5 text-sm muted">Nothing connected yet. Pick a channel below.</li>}
        {accounts.map((a) => {
          const c = channel(a.provider);
          const reconnect = ["gmail", "outlook", "slack"].includes(a.provider) ? connectHref(a.provider, a.can_send) : null;
          return (
            <li key={a.id} className="card flex flex-wrap items-center gap-3 p-3 sm:p-4">
              <ChannelAvatar provider={a.provider} name={accountName(a)} />
              <div className="min-w-0 flex-1">
                <RenameAccount id={a.id} label={a.label} fallback={a.display_name} />
                <p className="truncate text-xs muted">{c.name}{a.label ? ` · ${a.display_name}` : ""}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {perm(true, "Read")}
                  {perm(a.can_send, a.provider === "gmail" || a.provider === "outlook" ? "Send" : "Reply")}
                  {a.provider === "gmail" && perm(Boolean(manage[a.id]), "Manage (read/unread, star, trash)")}
                  {a.status !== "connected" && <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">{a.status === "needs_reauth" ? "Needs reconnect" : a.status === "error" ? "Sync error" : a.status.replace(/_/g, " ")}</span>}
                </div>
                {a.status_detail && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{a.status_detail}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                {reconnect && (a.status !== "connected" || !a.can_send || (a.provider === "gmail" && !manage[a.id])) && (
                  <a className="btn !py-1.5 !text-xs" href={connectHref(a.provider, true)}>{a.status !== "connected" ? "Reconnect" : "Upgrade access"}</a>
                )}
                <form action={disconnect}>
                  <input type="hidden" name="account_id" value={a.id} />
                  <ConfirmSubmit message={`Disconnect ${accountName(a)}? Its messages are removed from Unified Box. Nothing is deleted in ${c.name}.`} className="btn !py-1.5 !text-xs !text-red-600">Disconnect</ConfirmSubmit>
                </form>
              </div>
            </li>
          );
        })}
      </ul>

      {/* ---------- add ---------- */}
      <div className={section}><div><h2 className="text-lg font-semibold tracking-tight">Add a channel</h2><p className="text-sm muted">Sign in once; new messages then arrive automatically.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {live.map((p) => {
          const ready = p.id === "slack" ? slackConfigured() : isConfigured(p);
          const c = channel(p.id);
          return (
            <section key={p.id} aria-label={p.name} className="card flex flex-col p-4">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: c.color }}><ProviderIcon provider={p.id} /></span>
                <h3 className="font-semibold">{p.name}</h3>
                {!ready && <span className="chip ml-auto bg-[var(--surface-2)] muted">Coming soon</span>}
              </div>
              <p className="mb-4 mt-2 flex-1 text-sm muted">{p.blurb}</p>
              {ready && ["gmail", "outlook", "slack"].includes(p.id) && (
                <div className="flex flex-wrap items-center gap-2">
                  <a className="btn-primary" href={connectHref(p.id, true)}>Connect {c.name}</a>
                  <a className="text-xs muted underline-offset-4 hover:underline" href={connectHref(p.id, false)}>or read-only</a>
                </div>
              )}
              {ready && p.id === "whatsapp" && <WhatsAppForm />}
              {ready && p.id === "telegram" && <TelegramForm />}
            </section>
          );
        })}
      </div>
      <details className="mt-3 rounded-2xl border border-dashed border-[var(--border-strong)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">On the roadmap: {PROVIDERS.filter((p) => p.stage !== "live").map((p) => p.name).join(", ")}</summary>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {PROVIDERS.filter((p) => p.stage !== "live").map((p) => (
            <li key={p.id} className="flex gap-2 muted"><ProviderIcon provider={p.id} className="mt-0.5 h-4 w-4 shrink-0" /><span><span className="font-medium text-[var(--text)]">{p.name}</span>{p.stage === "unavailable" ? " · not possible" : ""}<br /><span className="text-xs">{p.blurb}</span></span></li>
          ))}
        </ul>
      </details>

      {/* ---------- clients ---------- */}
      <div className={section}>
        <div><h2 className="text-lg font-semibold tracking-tight">Client groups</h2><p className="text-sm muted">Group conversations by client. Add a domain (acme.com) or an email address and matching messages are tagged automatically, across every channel.</p></div>
      </div>
      {rulesErr && <p className="mb-2 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">Automatic tagging needs database migration 0004. You can still create clients and assign conversations by hand.</p>}
      <form action={addClient} className="card flex gap-2 p-2">
        <input name="name" required maxLength={80} placeholder="New client name, e.g. Greenbridge" aria-label="New client name" className="field !border-0 !shadow-none" />
        <button className="btn-primary shrink-0"><Icon name="plus" /> Add client</button>
      </form>
      <div className="mt-3 grid gap-3">
        {clients.length === 0 && <p className="px-1 text-sm muted">No clients yet.</p>}
        {clients.map((c) => {
          const mine = rules.filter((r) => r.client_id === c.id);
          return (
            <section key={c.id} aria-label={c.name} className="card p-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-xs font-bold text-violet-700 dark:text-violet-300">{c.name.slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{c.name}</h3><p className="text-xs muted">{mine.length ? `${mine.length} matching rule${mine.length === 1 ? "" : "s"}` : "No rules yet, so tag conversations by hand or add a rule"}</p></div>
                <a href={`/?client=${c.id}`} className="btn !py-1.5 !text-xs">View</a>
                <form action={removeClient}><input type="hidden" name="client_id" value={c.id} /><ConfirmSubmit message={`Delete client ${c.name}? Conversations stay, they just lose this tag.`} className="btn !py-1.5 !text-xs !text-red-600">Delete</ConfirmSubmit></form>
              </div>
              {mine.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {mine.map((r) => (
                    <li key={r.id} className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] py-1 pl-3 pr-1 text-xs">
                      <span className="muted">{r.kind === "domain" ? "Domain" : "Email"}</span><span className="font-medium">{r.kind === "domain" ? `@${r.pattern}` : r.pattern}</span>
                      <form action={removeRule}><input type="hidden" name="rule_id" value={r.id} /><button aria-label={`Remove ${r.pattern}`} title="Remove" className="inline-flex h-5 w-5 items-center justify-center rounded-full muted hover:bg-[var(--surface-3)] hover:text-red-600"><Icon name="close" className="h-3 w-3" /></button></form>
                    </li>
                  ))}
                </ul>
              )}
              {!rulesErr && (
                <form action={addClientRule} className="mt-3 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                  <input type="hidden" name="client_id" value={c.id} />
                  <select name="kind" aria-label="Rule type" className="field !w-auto"><option value="domain">Domain</option><option value="email">Email</option></select>
                  <input name="pattern" required placeholder="acme.com or jane@acme.com" aria-label="Domain or email" className="field min-w-0 flex-1" />
                  <button className="btn">Add rule</button>
                </form>
              )}
            </section>
          );
        })}
      </div>

      <div className={section}><div><h2 className="text-lg font-semibold tracking-tight">AI apps</h2><p className="text-sm muted">Connect Claude, ChatGPT and others, and see or revoke their access, on <Link href="/connect-ai" className="font-medium text-[var(--accent-text)] hover:underline">Connect your AI</Link>.</p></div></div>
    </main>
    </PageFrame>
  );
}

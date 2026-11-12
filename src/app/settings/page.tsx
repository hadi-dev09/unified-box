import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { disconnectAccount } from "@/lib/accounts";
import { addRule, createClientRecord, deleteClientRecord, deleteRule } from "@/lib/clients";
import { supabaseServer } from "@/lib/supabase/server";
import { ConfirmSubmit } from "./confirm-submit";

async function userId() {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
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
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return;
  await disconnectAccount(user.id, String(form.get("account_id") ?? ""));
  revalidatePath("/settings");
  revalidatePath("/");
}

async function revoke(form: FormData) {
  "use server";
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return;
  const clientId = String(form.get("client_id") ?? "");
  const db = supabaseAdmin();
  await db.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", user.id).eq("client_id", clientId).is("revoked_at", null);
  await db.from("audit_log").insert({ user_id: user.id, actor: "user", action: "oauth.revoked", target: clientId });
  revalidatePath("/settings");
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { msg } = await searchParams;
  const { data: accounts } = await sb.from("accounts").select("id, display_name, account_type, status, status_detail, can_send");
  const { data: grants } = await supabaseAdmin().from("oauth_tokens").select("client_id, oauth_clients(client_name)").eq("user_id", user.id).eq("kind", "refresh").is("revoked_at", null).gt("expires_at", new Date().toISOString());
  const apps = [...new Map((grants ?? []).map((g) => [g.client_id, (g.oauth_clients as unknown as { client_name: string } | null)?.client_name ?? g.client_id])).entries()];
  const [{ data: clientRows }, { data: ruleRows, error: rulesErr }] = await Promise.all([
    sb.from("clients").select("id, name").order("name"),
    sb.from("client_rules").select("id, client_id, kind, pattern").order("pattern"),
  ]);
  const clients = (clientRows ?? []) as { id: string; name: string }[];
  const rules = (ruleRows ?? []) as { id: string; client_id: string; kind: string; pattern: string }[];
  const field = "rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";
  const btn = "rounded-lg border border-neutral-300 px-3 py-3 text-sm dark:border-neutral-700";
  return (
    <main className="mx-auto max-w-xl p-4">
      <Link href="/" className="text-sm text-blue-600">← Inbox</Link>
      <h1 className="my-3 text-xl font-semibold">Connect accounts</h1>
      {msg && <p className="mb-3 rounded bg-neutral-100 p-3 text-sm dark:bg-neutral-900">{msg}</p>}
      <h2 className="mt-4 font-medium">Gmail</h2>
      <p className="mb-2 text-sm text-neutral-500">Read-only by default. Enable sending only if you want to approve and send replies from here.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <a className={btn} href="/api/connect/gmail?type=personal">Personal · read-only</a>
        <a className={btn} href="/api/connect/gmail?type=company">Company · read-only</a>
        <a className={btn} href="/api/connect/gmail?type=personal&write=1">Personal · read + send</a>
        <a className={btn} href="/api/connect/gmail?type=company&write=1">Company · read + send</a>
      </div>
      <p className="mt-2 text-xs text-neutral-500">Company accounts may be blocked by a Workspace admin; you'll see a clear message if so. Slack, WhatsApp, Upwork and Telegram are coming next.</p>
      <h2 className="mt-6 font-medium">Connected</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {(accounts ?? []).length === 0 && <li className="text-neutral-500">No accounts yet. Connect one above.</li>}
        {(accounts ?? []).map((a) => (
          <li key={a.id} className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{a.display_name}</div>
                <div className="text-xs text-neutral-500">{a.account_type} · {a.status === "connected" ? "connected" : a.status.replace(/_/g, " ")} · {a.can_send ? "can send (with approval)" : "read-only"}</div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                {a.status !== "connected" && <a className="text-blue-600" href={`/api/connect/gmail?type=${a.account_type}${a.can_send ? "&write=1" : ""}`}>Reconnect</a>}
                <form action={disconnect}>
                  <input type="hidden" name="account_id" value={a.id} />
                  <ConfirmSubmit message={`Disconnect ${a.display_name}? Its synced messages will be deleted from Unified Box. Your real mailbox is not touched.`} className="text-red-600">Disconnect</ConfirmSubmit>
                </form>
              </div>
            </div>
            {a.status_detail && <div className="mt-1 text-xs text-red-600">{a.status_detail}</div>}
          </li>
        ))}
      </ul>
      <h2 className="mt-6 font-medium">Clients</h2>
      <p className="mb-2 text-sm text-neutral-500">Group conversations by client. Add a sender email or domain and matching threads are tagged automatically (also across Gmail accounts).</p>
      {rulesErr && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">Auto-tagging rules need database migration 0004 (see CHECKLIST.md). You can still create clients and assign threads by hand.</p>}
      <form action={addClient} className="flex gap-2">
        <input name="name" required maxLength={80} placeholder="New client, e.g. Greenbridge" className={`${field} min-w-0 flex-1`} />
        <button className={btn}>Add</button>
      </form>
      <ul className="mt-3 space-y-2 text-sm">
        {clients.map((c) => (
          <li key={c.id} className="rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="font-medium">{c.name}</span>
              <form action={removeClient}><input type="hidden" name="client_id" value={c.id} /><ConfirmSubmit message={`Delete client ${c.name}? Threads stay, they just lose this tag.`} className="text-xs text-red-600">Delete</ConfirmSubmit></form>
            </div>
            <ul className="mt-1 space-y-1">
              {rules.filter((r) => r.client_id === c.id).map((r) => (
                <li key={r.id} className="flex items-center justify-between text-xs text-neutral-500">
                  <span>{r.kind === "domain" ? "@" : ""}{r.pattern}</span>
                  <form action={removeRule}><input type="hidden" name="rule_id" value={r.id} /><button className="text-red-600">Remove</button></form>
                </li>
              ))}
            </ul>
            {!rulesErr && (
              <form action={addClientRule} className="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="client_id" value={c.id} />
                <select name="kind" className={field} aria-label="Rule type"><option value="domain">Domain</option><option value="email">Email</option></select>
                <input name="pattern" required placeholder="greenbridge.io or jane@greenbridge.io" className={`${field} min-w-0 flex-1`} />
                <button className={btn}>Add rule</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <h2 className="mt-6 font-medium">Connected apps (Claude)</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {apps.length === 0 && <li className="text-neutral-500">None yet. Add {process.env.APP_URL}/api/mcp as a custom connector in Claude.</li>}
        {apps.map(([id, name]) => (
          <li key={id} className="flex items-center justify-between rounded border border-neutral-200 p-3 dark:border-neutral-800">
            <span>{name}</span>
            <form action={revoke}><input type="hidden" name="client_id" value={id} /><button className="text-red-600">Revoke</button></form>
          </li>
        ))}
      </ul>
    </main>
  );
}

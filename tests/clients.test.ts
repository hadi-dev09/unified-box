import { A, B, b64url, db, stubFetch } from "./setup";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { matchClient, normalizePattern } from "../src/lib/client-match";
import { addRule, createClientRecord, deleteClientRecord, deleteRule, setThreadClient } from "../src/lib/clients";
import { syncAccount } from "../src/lib/sync";
import { encrypt } from "../src/lib/crypto";
import { tools } from "../src/lib/mcp-tools";

beforeEach(() => db.reset());

test("normalizePattern validates emails and domains", () => {
  assert.equal(normalizePattern("domain", " @Acme.COM "), "acme.com");
  assert.equal(normalizePattern("domain", "not a domain"), null);
  assert.equal(normalizePattern("domain", "localhost"), null);
  assert.equal(normalizePattern("email", "Jane@Acme.com"), "jane@acme.com");
  assert.equal(normalizePattern("email", "acme.com"), null);
  assert.equal(normalizePattern("email", "a@b.com,c@d.com"), null);
});

test("matchClient: email beats domain, domain covers subdomains but not lookalikes", () => {
  const rules = [
    { client_id: "dom", kind: "domain" as const, pattern: "acme.com" },
    { client_id: "vip", kind: "email" as const, pattern: "ceo@acme.com" },
    { client_id: "other", kind: "domain" as const, pattern: "other.io" },
  ];
  assert.equal(matchClient(rules, ["x@acme.com"]), "dom");
  assert.equal(matchClient(rules, ["x@acme.com", "CEO@acme.com"]), "vip");
  assert.equal(matchClient(rules, ["x@mail.acme.com"]), "dom");
  assert.equal(matchClient(rules, ["x@notacme.com"]), null, "suffix lookalike must not match");
  assert.equal(matchClient(rules, ["x@acme.com.evil.io"]), null);
  assert.equal(matchClient(rules, ["nobody"]), null);
  assert.equal(matchClient([], ["x@acme.com"]), null);
});

async function setup() {
  await createClientRecord(A.id, "Acme");
  await createClientRecord(B.id, "BeeCorp");
  return { acme: db.rows("clients").find((c) => c.user_id === A.id)!.id as string, bee: db.rows("clients").find((c) => c.user_id === B.id)!.id as string };
}
function thread(id: string, user = A, from = "jane@acme.com", client: string | null = null) {
  db.rows("threads").push({ id, user_id: user.id, account_id: "ac", external_id: id, subject: id, last_message_at: new Date().toISOString(), client_id: client });
  db.rows("messages").push({ id: `m-${id}`, user_id: user.id, account_id: "ac", thread_id: id, external_id: `e-${id}`, from_addr: from, to_addrs: [user.email], sent_at: new Date().toISOString() });
}

test("clients: duplicates rejected, blank rejected, owner-only deletes", async () => {
  const { acme, bee } = await setup();
  assert.equal((await createClientRecord(A.id, "Acme")).ok, false);
  assert.equal((await createClientRecord(A.id, "   ")).ok, false);
  await deleteClientRecord(A.id, bee); // B's client
  assert.equal(db.rows("clients").length, 2, "A cannot delete B's client");
  await deleteClientRecord(A.id, acme);
  assert.equal(db.rows("clients").length, 1);
});

test("rules: validated, owner-only, backfill tags existing threads but never overwrites manual choice", async () => {
  const { acme, bee } = await setup();
  thread("t1"); thread("t2", A, "jane@acme.com", "manual-client"); thread("t3", A, "x@else.com"); thread("tb", B, "jane@acme.com");
  assert.equal((await addRule(A.id, acme, "domain", "nope")).ok, false);
  assert.equal((await addRule(A.id, bee, "domain", "acme.com")).ok, false, "cannot attach rules to another user's client");
  assert.equal((await addRule(A.id, acme, "domain", "acme.com")).ok, true);
  assert.equal((await addRule(A.id, acme, "domain", "ACME.com")).ok, false, "duplicate");

  const c = (id: string) => db.rows("threads").find((t) => t.id === id)!.client_id;
  assert.equal(c("t1"), acme);
  assert.equal(c("t2"), "manual-client");
  assert.equal(c("t3"), null);
  assert.equal(c("tb"), null, "other users' threads untouched");

  const rid = db.rows("client_rules")[0].id;
  await deleteRule(B.id, rid);
  assert.equal(db.rows("client_rules").length, 1, "B cannot delete A's rule");
  await deleteRule(A.id, rid);
  assert.equal(db.rows("client_rules").length, 0);
});

test("setThreadClient: only your own threads and clients", async () => {
  const { acme, bee } = await setup();
  thread("t1"); thread("tb", B);
  assert.equal((await setThreadClient(A.id, "t1", bee)).ok, false);
  assert.equal((await setThreadClient(A.id, "t1", acme)).ok, true);
  assert.equal(db.rows("threads").find((t) => t.id === "t1")!.client_id, acme);
  await setThreadClient(A.id, "tb", acme); // someone else's thread
  assert.equal(db.rows("threads").find((t) => t.id === "tb")!.client_id, null);
  await setThreadClient(A.id, "t1", null);
  assert.equal(db.rows("threads").find((t) => t.id === "t1")!.client_id, null);
});

test("sync auto-tags new threads by rule and keeps manual assignments", async () => {
  const { acme } = await setup();
  await addRule(A.id, acme, "domain", "acme.com");
  db.rows("accounts").push({ id: "acct1", user_id: A.id, provider: "gmail", account_type: "personal", display_name: A.email, external_id: A.email, status: "connected", can_send: false });
  db.rows("account_secrets").push({ account_id: "acct1", tokens_enc: encrypt(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3_600_000, scope: "x" })) });
  const mk = (id: string, from: string) => ({ id, threadId: `t-${id}`, internalDate: "1700000000000", snippet: "s", labelIds: [], payload: { mimeType: "text/plain", body: { data: b64url("hi") }, headers: [{ name: "From", value: from }, { name: "To", value: A.email }, { name: "Subject", value: id }] } });
  const msgs: Record<string, unknown> = { a: mk("a", "Jane <jane@acme.com>"), b: mk("b", "Bob <bob@random.org>") };
  const net = stubFetch((c) => {
    if (c.url.includes("/messages?")) return { messages: [{ id: "a" }, { id: "b" }] };
    const m = c.url.match(/\/messages\/(\w+)\?format=full/);
    if (m) return msgs[m[1]];
  });
  try {
    await syncAccount("acct1");
    const t = (ext: string) => db.rows("threads").find((x) => x.external_id === ext)!;
    assert.equal(t("t-a").client_id, acme);
    assert.equal(t("t-b").client_id, null);
    t("t-a").client_id = "hand-picked";
    await syncAccount("acct1");
    assert.equal(t("t-a").client_id, "hand-picked", "re-sync must not override a manual choice");
  } finally { net.restore(); }
});

test("MCP list_threads can filter by client name and stays user-scoped", async () => {
  const { acme } = await setup();
  thread("t1", A, "jane@acme.com", acme); thread("t2", A);
  db.rows("accounts").push({ id: "ac", user_id: A.id, display_name: A.email, account_type: "personal" });
  const tool = tools.find((t) => t.name === "list_threads")!;
  const run = (uid: string, args: object) => (tool.run as (u: string, a: unknown) => Promise<{ threads: { id: string }[]; note?: string }>)(uid, tool.schema.parse(args));
  assert.deepEqual((await run(A.id, { client: "acme" })).threads.map((t) => t.id), ["t1"]);
  assert.match((await run(A.id, { client: "BeeCorp" })).note ?? "", /No client named/, "B's client is invisible to A");
  assert.equal((await run(B.id, { client: "Acme" })).threads.length, 0);
});

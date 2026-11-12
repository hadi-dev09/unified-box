// In-memory stand-in for the subset of the Supabase query builder this app uses.
// Used ONLY by tests (UNIFIED_BOX_TEST=1) and local demo mode (DEMO_MODE=1, never in production).
import { randomUUID } from "node:crypto";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Result = { data: any; error: { message: string } | null; count?: number }; // eslint-disable-line @typescript-eslint/no-explicit-any

const now = () => new Date().toISOString();
const PK: Record<string, string> = { oauth_clients: "client_id", oauth_codes: "code_hash", oauth_tokens: "token_hash", account_secrets: "account_id" };
const RELATIONS: Record<string, Record<string, string>> = {
  threads: { accounts: "account_id", clients: "client_id" },
  drafts: { accounts: "account_id" },
  oauth_tokens: { oauth_clients: "client_id" },
};
// Mirrors the UNIQUE constraints in supabase/migrations so inserts fail like Postgres would.
const UNIQUE: Record<string, string[][]> = {
  accounts: [["user_id", "provider", "external_id"]],
  clients: [["user_id", "name"]],
  client_rules: [["user_id", "kind", "pattern"]],
  threads: [["account_id", "external_id"]],
  messages: [["account_id", "external_id"]],
  api_tokens: [["token_hash"]],
};
const DEFAULTS: Record<string, () => Row> = {
  accounts: () => ({ status: "connected", status_detail: null, can_send: false, account_type: "personal", last_synced_at: null, created_at: now() }),
  threads: () => ({ unread: false, needs_reply: false, client_id: null, last_from: null, snippet: null, subject: null, seen_at: null }),
  messages: () => ({ is_outgoing: false, to_addrs: [], cc_addrs: [], rfc_message_id: null, from_name: null }),
  drafts: () => ({ status: "pending", error: null, decided_at: null, thread_id: null, cc_addrs: [], mode: "reply", created_at: now() }),
  api_tokens: () => ({ created_at: now(), last_used_at: null, revoked_at: null }),
  oauth_codes: () => ({ used: false, resource: null }),
  oauth_tokens: () => ({ revoked_at: null, created_at: now() }),
  oauth_clients: () => ({ created_at: now() }),
  audit_log: () => ({ meta: {}, created_at: now() }),
};

const likeToRegex = (p: string) => new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0); // eslint-disable-line @typescript-eslint/no-explicit-any

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  private onConflict?: string;
  private filters: ((r: Row) => boolean)[] = [];
  private cols = "*";
  private returning = true;
  private head = false;
  private wantCount = false;
  private ord?: { col: string; asc: boolean };
  private lim?: number;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(private db: FakeDb, private table: string) {}

  select(cols = "*", o?: { head?: boolean; count?: string }) {
    this.cols = cols; this.returning = true;
    if (o?.head) this.head = true;
    if (o?.count) this.wantCount = true;
    return this;
  }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; this.returning = false; return this; }
  upsert(p: Row | Row[], o?: { onConflict?: string }) { this.op = "upsert"; this.payload = p; this.onConflict = o?.onConflict; this.returning = false; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; this.returning = false; return this; }
  delete() { this.op = "delete"; this.returning = false; return this; }

  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
  in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
  gt(c: string, v: any) { this.filters.push((r) => r[c] != null && cmp(r[c], v) > 0); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
  gte(c: string, v: any) { this.filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
  ilike(c: string, p: string) { const re = likeToRegex(p); this.filters.push((r) => re.test(String(r[c] ?? ""))); return this; }
  or(expr: string) {
    const parts = splitTop(expr).map((e) => {
      const [col, op, ...rest] = e.split(".");
      const val = rest.join(".");
      if (op === "ilike") { const re = likeToRegex(val); return (r: Row) => re.test(String(r[col] ?? "")); }
      return (r: Row) => String(r[col]) === val;
    });
    this.filters.push((r) => parts.some((f) => f(r)));
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) { this.ord = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  private project(row: Row, cols: string): Row {
    if (cols.trim() === "*") return { ...row };
    const out: Row = {};
    for (const tok of splitTop(cols)) {
      const m = tok.match(/^(\w+)\((.*)\)$/s);
      if (m) {
        const fk = RELATIONS[this.table]?.[m[1]];
        const target = fk ? this.db.rows(m[1]).find((t) => t[PK[m[1]] ?? "id"] === row[fk]) : undefined;
        out[m[1]] = target ? this.project(target, m[2]) : null;
      } else out[tok] = row[tok];
    }
    return out;
  }

  private exec(): Result {
    const rows = this.db.rows(this.table);
    const pk = PK[this.table] ?? "id";
    const fail = (message: string): Result => ({ data: null, error: { message } });
    let affected: Row[] = [];

    if (this.op === "insert" || this.op === "upsert") {
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const row: Row = { ...(DEFAULTS[this.table]?.() ?? {}), ...p };
        if (pk === "id" && !row.id) row.id = randomUUID();
        const keys = this.op === "upsert" ? (this.onConflict ?? pk).split(",").map((s) => s.trim()) : [pk];
        const existing = rows.find((r) => keys.every((k) => r[k] === row[k] && row[k] !== undefined));
        if (!existing || this.op === "insert") {
          const clash = (UNIQUE[this.table] ?? []).some((cols) => rows.some((r) => cols.every((c) => r[c] === row[c])));
          if (clash) return fail(`duplicate key value violates unique constraint on ${this.table}`);
        }
        if (existing) {
          if (this.op === "insert") return fail(`duplicate key value violates unique constraint on ${this.table}`);
          Object.assign(existing, p); affected.push(existing);
        } else { rows.push(row); affected.push(row); }
      }
    } else {
      affected = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") affected.forEach((r) => Object.assign(r, this.payload));
      if (this.op === "delete") this.db.tables[this.table] = rows.filter((r) => !affected.includes(r));
    }

    if (this.op === "select" || this.returning) {
      let out = this.op === "select" ? affected : affected;
      if (this.ord) { const { col, asc } = this.ord; out = [...out].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col])); }
      if (this.lim !== undefined) out = out.slice(0, this.lim);
      const count = this.wantCount ? affected.length : undefined;
      if (this.head) return { data: null, error: null, count };
      const projected = out.map((r) => this.project(r, this.cols));
      if (this.mode === "single") return projected.length === 1 ? { data: projected[0], error: null, count } : fail("JSON object requested, multiple (or no) rows returned");
      if (this.mode === "maybe") return projected.length > 1 ? fail("multiple rows returned") : { data: projected[0] ?? null, error: null, count };
      return { data: projected, error: null, count };
    }
    return { data: null, error: null };
  }

  then<R1 = Result, R2 = never>(ok?: ((v: Result) => R1 | PromiseLike<R1>) | null, bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
    let res: Result;
    try { res = this.exec(); } catch (e) { return Promise.reject(e).then(ok, bad); }
    return Promise.resolve(res).then(ok, bad);
  }
}

type AuthUser = { id: string; email: string; password: string; confirmed: boolean };
const authErr = (message: string) => ({ data: { user: null, session: null }, error: { message } });

export class FakeDb {
  tables: Record<string, Row[]> = {};
  user: { id: string; email: string } | null = null;
  authUsers: AuthUser[] = [];
  authLog: { method: string; args: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  rows(t: string): Row[] { return (this.tables[t] ??= []); }
  from(t: string) { return new Query(this, t); }
  reset() { this.tables = {}; this.user = null; this.authUsers = []; this.authLog = []; }
  private log(method: string, args: unknown) { this.authLog.push({ method, args }); }
  private find(email: string) { return this.authUsers.find((u) => u.email === email.toLowerCase()); }
  auth = {
    getUser: async () => ({ data: { user: this.user }, error: null }),
    exchangeCodeForSession: async (code: string) => { this.log("exchangeCodeForSession", code); return code === "bad" ? authErr("invalid flow state") : { data: {}, error: null }; },
    signInWithPassword: async (a: { email: string; password: string }) => {
      this.log("signInWithPassword", a);
      const u = this.find(a.email);
      if (!u || u.password !== a.password) return authErr("Invalid login credentials");
      if (!u.confirmed) return authErr("Email not confirmed");
      this.user = { id: u.id, email: u.email };
      return { data: { user: this.user, session: {} }, error: null };
    },
    signUp: async (a: { email: string; password: string; options?: unknown }) => {
      this.log("signUp", a);
      if (!this.find(a.email)) this.authUsers.push({ id: randomUUID(), email: a.email.toLowerCase(), password: a.password, confirmed: false });
      return { data: { user: { id: "obfuscated" }, session: null }, error: null };
    },
    signInWithOtp: async (a: { email: string; options?: { shouldCreateUser?: boolean } }) => {
      this.log("signInWithOtp", a);
      if (a.options?.shouldCreateUser === false && !this.find(a.email)) return authErr("Signups not allowed for otp");
      return { data: {}, error: null };
    },
    verifyOtp: async (a: { email?: string; token?: string; token_hash?: string; type: string }) => {
      this.log("verifyOtp", a);
      if (a.token !== "123456" && a.token_hash !== "good-hash") return authErr("Token has expired or is invalid");
      const u = a.email ? this.find(a.email) : this.authUsers[0];
      if (u) { u.confirmed = true; this.user = { id: u.id, email: u.email }; }
      return { data: { session: {} }, error: null };
    },
    resend: async (a: unknown) => { this.log("resend", a); return { data: {}, error: null }; },
    resetPasswordForEmail: async (email: string, opts: unknown) => { this.log("resetPasswordForEmail", { email, opts }); return { data: {}, error: null }; },
    updateUser: async (a: { password?: string }) => {
      this.log("updateUser", a);
      if (!this.user) return authErr("Auth session missing!");
      const u = this.find(this.user.email);
      if (u && a.password) u.password = a.password;
      return { data: { user: this.user }, error: null };
    },
    signOut: async () => { this.log("signOut", null); this.user = null; return { error: null }; },
    signInWithOAuth: async (a: { provider: string; options: { redirectTo: string } }) => {
      this.log("signInWithOAuth", a);
      return { data: { url: `https://fake.supabase.co/auth/v1/authorize?provider=${a.provider}&redirect_to=${encodeURIComponent(a.options.redirectTo)}` }, error: null };
    },
  };
}

const g = globalThis as unknown as { __FAKE_DB__?: FakeDb };
export const fakeDb = () => {
  if (!g.__FAKE_DB__) {
    g.__FAKE_DB__ = new FakeDb();
    // Demo data is loaded lazily (require) so test runs and production never touch it.
    if (process.env.DEMO_MODE === "1" && process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require("./demo-seed") as typeof import("./demo-seed")).seedDemo(g.__FAKE_DB__);
    }
  }
  return g.__FAKE_DB__;
};

/** Fake is honoured only outside production, and only when explicitly enabled. */
export const useFakeSupabase = () =>
  process.env.NODE_ENV !== "production" && (process.env.UNIFIED_BOX_TEST === "1" || process.env.DEMO_MODE === "1");

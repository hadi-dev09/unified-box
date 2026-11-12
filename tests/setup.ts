// Must be the FIRST import in every test file: configures env before app code reads it.
import { randomBytes, randomUUID } from "node:crypto";

process.env.UNIFIED_BOX_TEST = "1";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.APP_URL = "https://app.test";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID = "gid";
process.env.GOOGLE_CLIENT_SECRET = "gsecret";
process.env.CRON_SECRET = "cron-secret-for-tests";

import { fakeDb } from "../src/lib/testing/fake-supabase";
export const db = fakeDb();
export const A = { id: randomUUID(), email: "a@example.com" };
export const B = { id: randomUUID(), email: "b@example.com" };

export type Call = { url: string; method: string; body: string };
/** Replaces global fetch. Handler returns a Response/JSON for matching URLs. */
export function stubFetch(handler: (c: Call) => unknown | Promise<unknown>) {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "" };
    calls.push(c);
    const out = await handler(c);
    if (out instanceof Response) return out;
    if (out === undefined) throw new Error(`Unexpected fetch: ${c.method} ${c.url}`);
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

export const b64url = (s: string) => Buffer.from(s).toString("base64url");

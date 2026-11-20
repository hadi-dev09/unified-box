import { after } from "next/server";

/** Runs work after the response is sent (Next.js `after`); outside a request (tests, scripts) it just starts it. */
export function later(fn: () => Promise<unknown>) {
  try { after(fn); } catch { void fn().catch(() => null); }
}

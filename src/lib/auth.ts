import { cache } from "react";
import { supabaseServer } from "./supabase/server";

export type CurrentUser = { id: string; email: string };

/**
 * The signed-in user, verified once per request. Uses getClaims(), which checks the session JWT locally
 * (asymmetric signing keys) instead of a round trip to Supabase Auth on every page.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getClaims();
  const c = data?.claims as { sub?: string; email?: string } | undefined;
  if (error || !c?.sub) return null;
  return { id: c.sub, email: c.email ?? "" };
});

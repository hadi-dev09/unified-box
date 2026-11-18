import { cache } from "react";
import { supabaseServer } from "./supabase/server";

export type CurrentUser = { id: string; email: string; name: string; avatarUrl: string | null; provider: string };

/**
 * The signed-in user, verified once per request. Uses getClaims(), which checks the session JWT locally
 * (asymmetric signing keys) instead of a round trip to Supabase Auth on every page.
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getClaims();
  const c = data?.claims as { sub?: string; email?: string; user_metadata?: { full_name?: string; name?: string; avatar_url?: string; picture?: string }; app_metadata?: { provider?: string } } | undefined;
  if (error || !c?.sub) return null;
  const m = c.user_metadata ?? {};
  return { id: c.sub, email: c.email ?? "", name: (m.full_name || m.name || "").trim(), avatarUrl: m.avatar_url || m.picture || null, provider: c.app_metadata?.provider ?? "email" };
});

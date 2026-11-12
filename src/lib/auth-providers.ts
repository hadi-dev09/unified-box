import { useFakeSupabase } from "./testing/fake-supabase";

/** Which social sign-in providers are switched on in Supabase (read from the public Auth settings endpoint). */
export async function enabledProviders(): Promise<{ google: boolean; slack: boolean }> {
  if (useFakeSupabase()) return { google: true, slack: false };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { google: false, slack: false };
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, next: { revalidate: 300 } });
    const j = (await r.json()) as { external?: Record<string, boolean> };
    return { google: Boolean(j.external?.google), slack: Boolean(j.external?.slack_oidc) };
  } catch {
    return { google: false, slack: false };
  }
}

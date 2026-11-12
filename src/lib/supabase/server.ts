import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "../env";
import { fakeDb, useFakeSupabase } from "../testing/fake-supabase";

/** Session-scoped client: RLS applies, acts as the signed-in user. */
export async function supabaseServer(): Promise<SupabaseClient> {
  if (useFakeSupabase()) return fakeDb() as unknown as SupabaseClient;
  const store = await cookies();
  return (createServerClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* called from a Server Component; safe to ignore */
        }
      },
    },
  }) as unknown) as SupabaseClient;
}

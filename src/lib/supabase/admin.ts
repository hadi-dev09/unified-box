import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";
import { fakeDb, useFakeSupabase } from "../testing/fake-supabase";

/** Service-role client: bypasses RLS. Server code only; always filter by user_id yourself. */
export function supabaseAdmin(): SupabaseClient {
  if (useFakeSupabase()) return fakeDb() as unknown as SupabaseClient;
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

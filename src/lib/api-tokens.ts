import { randomBytes } from "node:crypto";
import { sha256 } from "./oauth";
import { supabaseAdmin } from "./supabase/admin";

export const TOKEN_PREFIX = "ubx_";

/** Creates a personal access key. The full key is returned ONCE; only its hash is stored. */
export async function createApiToken(userId: string, rawName: string) {
  const name = rawName.trim().slice(0, 60) || "AI app";
  const db = supabaseAdmin();
  const { count } = await db.from("api_tokens").select("id", { count: "exact", head: true }).eq("user_id", userId).is("revoked_at", null);
  if ((count ?? 0) >= 20) return { error: "You already have 20 active keys. Revoke one first." };
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const { error } = await db.from("api_tokens").insert({ user_id: userId, name, token_hash: sha256(token), prefix: token.slice(0, 10) });
  if (error) return { error: "Could not create key" };
  await db.from("audit_log").insert({ user_id: userId, actor: "user", action: "api_token.created", target: name });
  return { token };
}

export async function revokeApiToken(userId: string, id: string) {
  const db = supabaseAdmin();
  await db.from("api_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).is("revoked_at", null);
  await db.from("audit_log").insert({ user_id: userId, actor: "user", action: "api_token.revoked", target: id });
}

/** Resolves a personal access key to its user, or null. */
export async function userFromApiToken(token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const db = supabaseAdmin();
  const { data } = await db.from("api_tokens").select("id, user_id, revoked_at, last_used_at").eq("token_hash", sha256(token)).maybeSingle();
  if (!data || data.revoked_at) return null;
  // Record usage at most once a minute (cheap audit trail of which key is active).
  if (!data.last_used_at || Date.now() - new Date(data.last_used_at).getTime() > 60_000) {
    await db.from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  }
  return data.user_id as string;
}

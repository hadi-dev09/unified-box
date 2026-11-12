import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "./env";
import { supabaseAdmin } from "./supabase/admin";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 60 * 60 * 24 * 30;

export const baseUrl = () => env("APP_URL").replace(/\/$/, "");

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
};
export const preflight = () => new NextResponse(null, { status: 204, headers: CORS });
export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...CORS, "cache-control": "no-store", ...extra } });

/** Redirect URIs must be https, or loopback http for local clients. */
export function validRedirectUri(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export async function getClient(clientId: string) {
  const { data } = await supabaseAdmin().from("oauth_clients").select("client_id, client_name, redirect_uris").eq("client_id", clientId).maybeSingle();
  return data;
}

export async function issueTokens(userId: string, clientId: string) {
  const db = supabaseAdmin();
  const access = randomToken(), refresh = randomToken();
  const now = Date.now();
  const { error } = await db.from("oauth_tokens").insert([
    { token_hash: sha256(access), kind: "access", client_id: clientId, user_id: userId, expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
    { token_hash: sha256(refresh), kind: "refresh", client_id: clientId, user_id: userId, expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
  ]);
  if (error) throw new Error(error.message);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh };
}

/** Returns the user id for a valid OAuth access token or personal access key (ubx_...). */
export async function userFromBearer(header: string | null): Promise<string | null> {
  const token = header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
  if (!token) return null;
  if (token.startsWith("ubx_")) {
    const { userFromApiToken } = await import("./api-tokens");
    return userFromApiToken(token);
  }
  const { data } = await supabaseAdmin().from("oauth_tokens").select("user_id, expires_at, revoked_at").eq("token_hash", sha256(token)).eq("kind", "access").maybeSingle();
  if (!data || data.revoked_at || new Date(data.expires_at) < new Date()) return null;
  return data.user_id as string;
}

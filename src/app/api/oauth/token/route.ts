import { NextRequest } from "next/server";
import { getClient, issueTokens, json, pkceChallenge, preflight, sha256 } from "@/lib/oauth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const OPTIONS = preflight;
const err = (error: string, description?: string) => json({ error, error_description: description }, 400);

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  const p: Record<string, string> = ct.includes("json")
    ? await req.json().catch(() => ({}))
    : Object.fromEntries(new URLSearchParams(await req.text()));
  const db = supabaseAdmin();

  if (!p.client_id || !(await getClient(p.client_id))) return json({ error: "invalid_client" }, 401);

  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.code_verifier || !p.redirect_uri) return err("invalid_request");
    // Atomic single-use: only one request can flip used=false -> true.
    const { data: c } = await db.from("oauth_codes").update({ used: true }).eq("code_hash", sha256(p.code)).eq("used", false).select("*").maybeSingle();
    if (!c || new Date(c.expires_at) < new Date() || c.client_id !== p.client_id || c.redirect_uri !== p.redirect_uri) return err("invalid_grant");
    if (pkceChallenge(p.code_verifier) !== c.code_challenge) return err("invalid_grant", "PKCE verification failed");
    await db.from("audit_log").insert({ user_id: c.user_id, actor: "system", action: "oauth.token_issued", target: p.client_id });
    return json(await issueTokens(c.user_id, c.client_id));
  }

  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token) return err("invalid_request");
    const { data: t } = await db.from("oauth_tokens").select("*").eq("token_hash", sha256(p.refresh_token)).eq("kind", "refresh").maybeSingle();
    if (!t || t.client_id !== p.client_id) return err("invalid_grant");
    if (t.revoked_at) {
      // A rotated refresh token was replayed: assume theft and revoke this client's whole grant.
      await db.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("user_id", t.user_id).eq("client_id", t.client_id).is("revoked_at", null);
      return err("invalid_grant", "refresh token reuse detected");
    }
    if (new Date(t.expires_at) < new Date()) return err("invalid_grant", "expired");
    // Atomic rotation
    const { data: rot } = await db.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("token_hash", t.token_hash).is("revoked_at", null).select("token_hash").maybeSingle();
    if (!rot) return err("invalid_grant");
    return json(await issueTokens(t.user_id, t.client_id));
  }

  return err("unsupported_grant_type");
}

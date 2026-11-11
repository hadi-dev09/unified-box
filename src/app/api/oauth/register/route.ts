import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { json, preflight, validRedirectUri } from "@/lib/oauth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const OPTIONS = preflight;

// RFC 7591 dynamic client registration. Public clients only (PKCE, no secret).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const uris: unknown = b?.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every((u) => typeof u === "string" && validRedirectUri(u))) {
    return json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be https (or loopback http) URLs" }, 400);
  }
  const name = typeof b.client_name === "string" && b.client_name.trim() ? b.client_name.trim().slice(0, 100) : "Unnamed app";
  const client_id = randomBytes(16).toString("hex");
  const { error } = await supabaseAdmin().from("oauth_clients").insert({ client_id, client_name: name, redirect_uris: uris });
  if (error) return json({ error: "server_error" }, 500);
  return json({
    client_id, client_name: name, redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
  }, 201);
}

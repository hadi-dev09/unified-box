import { decrypt } from "./crypto";
import { slackRevoke } from "./slack";
import { supabaseAdmin } from "./supabase/admin";

/** Removes a connected account and everything synced from it (DB cascades), and revokes Google's grant. */
export async function disconnectAccount(userId: string, accountId: string): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin();
  const { data: acct } = await db.from("accounts").select("id, provider, external_id").eq("id", accountId).eq("user_id", userId).maybeSingle();
  if (!acct) return { ok: false, error: "Account not found" };

  if (acct.provider === "gmail") {
    // Best effort: tell Google to revoke so the app disappears from the user's Google permissions too.
    try {
      const { data: sec } = await db.from("account_secrets").select("tokens_enc").eq("account_id", accountId).maybeSingle();
      if (sec) {
        const t = JSON.parse(decrypt(sec.tokens_enc));
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: t.refresh_token ?? t.access_token }),
        });
      }
    } catch { /* ignore: deletion must still proceed */ }
  }

  if (acct.provider === "slack") {
    try {
      const { data: sec } = await db.from("account_secrets").select("tokens_enc").eq("account_id", accountId).maybeSingle();
      if (sec) await slackRevoke(JSON.parse(decrypt(sec.tokens_enc)).access_token);
    } catch { /* best effort */ }
  }

  const { error } = await db.from("accounts").delete().eq("id", accountId).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  await db.from("audit_log").insert({ user_id: userId, actor: "user", action: "account.disconnected", target: acct.external_id, meta: { provider: acct.provider } });
  return { ok: true };
}

/** Housekeeping for the daily cron: drop long-expired OAuth codes and tokens. */
export async function cleanupExpired() {
  const db = supabaseAdmin();
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  await db.from("oauth_codes").delete().lt("expires_at", cutoff);
  await db.from("oauth_tokens").delete().lt("expires_at", cutoff);
}

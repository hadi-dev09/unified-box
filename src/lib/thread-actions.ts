import { gmailHasScope, gmailModifyThread, gmailTrashThread, MODIFY_SCOPE } from "./gmail";
import { supabaseAdmin } from "./supabase/admin";

export const THREAD_ACTIONS = ["read", "unread", "star", "unstar", "snooze", "unsnooze", "trash", "restore"] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];

type Row = { id: string; external_id: string; account_id: string; accounts: { provider: string } | null };

/**
 * Applies an action to the user's own conversations. Changes always apply in Unified Box; for Gmail accounts that
 * granted "manage" access they are mirrored to Gmail too (read/unread, star, trash). Snooze is Unified Box only.
 * Returns how many were mirrored and a note when some couldn't be.
 */
export async function applyThreadAction(userId: string, ids: string[], action: ThreadAction, opts: { until?: string; actor?: "user" | "claude" } = {}) {
  const clean = [...new Set(ids.filter((x) => typeof x === "string" && x.length < 64))].slice(0, 200);
  if (!clean.length) return { ok: false, error: "Nothing selected" };
  if (!THREAD_ACTIONS.includes(action)) return { ok: false, error: "Unknown action" };
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  let until: string | null = null;
  if (action === "snooze") {
    const t = opts.until ? new Date(opts.until) : null;
    if (!t || Number.isNaN(t.getTime()) || t.getTime() < Date.now() + 60_000 || t.getTime() > Date.now() + 366 * 86400_000) return { ok: false, error: "Pick a time in the future" };
    until = t.toISOString();
  }
  const patch: Record<string, unknown> = {
    read: { unread: false, seen_at: now }, unread: { unread: true, seen_at: null },
    star: { starred: true }, unstar: { starred: false },
    snooze: { snoozed_until: until }, unsnooze: { snoozed_until: null },
    trash: { trashed_at: now }, restore: { trashed_at: null },
  }[action];
  const { data, error } = await db.from("threads").update(patch).eq("user_id", userId).in("id", clean).select("id, external_id, account_id, accounts(provider)");
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as unknown as Row[];

  // Mirror to Gmail where allowed.
  let mirrored = 0, skipped = 0;
  const gmail = rows.filter((r) => r.accounts?.provider === "gmail");
  const canModify = new Map<string, boolean>();
  if (["read", "unread", "star", "unstar", "trash", "restore"].includes(action)) {
    for (const r of gmail) {
      if (!canModify.has(r.account_id)) canModify.set(r.account_id, await gmailHasScope(r.account_id, MODIFY_SCOPE));
      if (!canModify.get(r.account_id)) { skipped++; continue; }
      try {
        if (action === "read") await gmailModifyThread(r.account_id, r.external_id, [], ["UNREAD"]);
        if (action === "unread") await gmailModifyThread(r.account_id, r.external_id, ["UNREAD"], []);
        if (action === "star") await gmailModifyThread(r.account_id, r.external_id, ["STARRED"], []);
        if (action === "unstar") await gmailModifyThread(r.account_id, r.external_id, [], ["STARRED"]);
        if (action === "trash") await gmailTrashThread(r.account_id, r.external_id);
        if (action === "restore") await gmailTrashThread(r.account_id, r.external_id, true);
        mirrored++;
      } catch { skipped++; }
    }
  }
  // Mirror read/unread to Slack (moves your read position there) when the connection allows it.
  if (action === "read" || action === "unread") {
    const { slackMark } = await import("./slack");
    for (const r of rows.filter((x) => x.accounts?.provider === "slack")) {
      if (await slackMark(r.account_id, r.external_id, action === "read").catch(() => false)) mirrored++; else skipped++;
    }
  }
  if (action !== "read") await db.from("audit_log").insert({ user_id: userId, actor: opts.actor ?? "user", action: `thread.${action}`, target: `${rows.length} conversation(s)`, meta: { mirrored, skipped } });
  return { ok: true, count: rows.length, mirrored, note: skipped ? "Changed in Unified Box. To also change it in Gmail or Slack, reconnect that account in Settings (Upgrade access)." : undefined };
}

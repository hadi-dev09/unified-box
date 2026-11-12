// Fake data for `DEMO_MODE=1 npm run dev` (never used in production). Lets the UI be viewed without real accounts.
import type { FakeDb } from "./fake-supabase";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
export const DEMO_USER = { id: "00000000-0000-4000-8000-0000000000d0", email: "demo@example.com" };

export function seedDemo(db: FakeDb) {
  db.user = DEMO_USER;
  const u = DEMO_USER.id;
  const accts = [
    { id: "a1", display_name: "rafay.work@gmail.com", account_type: "personal", status: "connected" },
    { id: "a2", display_name: "rafay@acme-agency.com", account_type: "company", status: "needs_reauth", status_detail: "Token has been expired or revoked." },
    { id: "a3", display_name: "billing@greenbridge.io", account_type: "company", status: "connected" },
  ];
  for (const a of accts) db.rows("accounts").push({ user_id: u, provider: "gmail", external_id: a.display_name, can_send: a.id === "a1", last_synced_at: ago(3), ...a });

  const T: [string, string, string, string, string, number, boolean, boolean, boolean, string][] = [
    // id, account, from, subject, snippet, minutesAgo, unread, needsReply, outgoing, body
    ["t1", "a1", "Sarah Mitchell", "Re: Q4 deliverables - need your sign-off by Friday", "Hi Rafay, just checking whether the dashboard mockups are ready for review before we send them to the board", 12, true, true, false,
      "Hi Rafay,\n\nJust checking whether the dashboard mockups are ready for review. We need your sign-off by Friday so we can send them to the board on Monday.\n\nTwo specific things:\n• The revenue chart legend\n• Mobile layout of the client table\n\nThanks!\nSarah"],
    ["t2", "a3", "Greenbridge Accounts", "Invoice #1042 is overdue", "Our records show invoice #1042 for $2,400 is 7 days past due. Please confirm the payment date.", 95, true, true, false,
      "Hello,\n\nOur records show invoice #1042 for $2,400.00 is now 7 days past due. Please confirm the payment date or let us know if there is an issue.\n\nRegards,\nGreenbridge Accounts"],
    ["t3", "a1", "You", "Proposal: Phase 2 build", "Attached is the updated proposal with the revised timeline.", 180, false, false, true,
      "Hi Daniel,\n\nAttached is the updated proposal with the revised timeline and the two options we discussed. Happy to jump on a call whenever suits.\n\nBest,\nRafay"],
    ["t4", "a1", "Supabase", "Supa Update November 2026", "Everything that happened in the Supabase ecosystem this month", 240, false, false, false,
      "Everything that happened this month\nNew: branching improvements, faster cold starts, and a redesigned dashboard.\n\nRead more on our blog."],
    ["t5", "a2", "Daniel Okafor", "Contract renewal, any changes on your side?", "We'd like to renew for another 12 months at the current rate unless you want to discuss changes.", 1500, false, true, false,
      "Hi Rafay,\n\nWe'd like to renew for another 12 months at the current rate unless you want to discuss changes. Let me know by the end of the month.\n\nDaniel"],
    ["t6", "a1", "GitHub", "[hadi-dev09/unified-box] Run completed", "Your workflow run has completed", 2900, false, false, false, "Your workflow run has completed successfully."],
    ["t7", "a3", "Priya Nair", "Weekly update + a question about the API limits", "Thanks for the update! One question on rate limits: do they apply per key or per workspace?", 4400, true, true, false,
      "Thanks for the update!\n\nOne question on rate limits: do they apply per key or per workspace? We're planning a bulk import next week and want to avoid throttling.\n\nPriya"],
    ["t8", "a1", "Black Friday", "Black Friday is here: 70% off VPN Plus", "The sale you've been waiting for has arrived", 6000, false, false, false, "The sale you've been waiting for has arrived. Shop now."],
  ];
  for (const [id, account_id, from, subject, snippet, mins, unread, needs, out, body] of T) {
    db.rows("threads").push({ id, user_id: u, account_id, external_id: `e-${id}`, subject, snippet, last_message_at: ago(mins), unread, needs_reply: needs, last_from: from });
    db.rows("messages").push({ id: `m-${id}-1`, user_id: u, account_id, thread_id: id, external_id: `x-${id}`, from_addr: out ? "rafay.work@gmail.com" : `${from.toLowerCase().replace(/\W+/g, ".")}@example.com`, from_name: out ? null : from, to_addrs: ["rafay.work@gmail.com"], subject, body_text: body, sent_at: ago(mins), is_outgoing: out });
  }
  // a longer group conversation (Reply all) + an image-only message
  const t1 = db.rows("messages").find((m) => m.id === "m-t1-1")!;
  t1.cc_addrs = ["mark.chen@example.com", "board@example.com"];
  t1.to_addrs = ["rafay.work@gmail.com", "design@example.com"];
  db.rows("messages").push(
    { id: "m-t1-a", user_id: u, account_id: "a1", thread_id: "t1", external_id: "x-t1-a", from_addr: "mark.chen@example.com", from_name: "Mark Chen", to_addrs: ["sarah.mitchell@example.com"], cc_addrs: ["rafay.work@gmail.com"], subject: "Q4 deliverables", body_text: "Adding the board alias so they can follow along. Rafay, can you include the conversion funnel in the next draft?", sent_at: ago(2900), is_outgoing: false },
    { id: "m-t1-b", user_id: u, account_id: "a1", thread_id: "t1", external_id: "x-t1-b", from_addr: "sarah.mitchell@example.com", from_name: "Sarah Mitchell", to_addrs: ["rafay.work@gmail.com"], cc_addrs: ["mark.chen@example.com"], subject: "Q4 deliverables", body_text: "Kicking this off. We need dashboard mockups for the Q4 board pack. Details: https://www.notion.so/acme/q4-board-pack-mockups-1234567890abcdef", sent_at: ago(3000), is_outgoing: false },
  );
  db.rows("messages").push({ id: "m-t1-0", user_id: u, account_id: "a1", thread_id: "t1", external_id: "x-t1-0", from_addr: "rafay.work@gmail.com", from_name: null, to_addrs: ["sarah@example.com"], subject: "Q4 deliverables", body_text: "Hi Sarah, first drafts are attached. I'll refine the legend and the mobile table this week.", sent_at: ago(1500), is_outgoing: true });
  db.rows("messages").push({ id: "m-t4-img", user_id: u, account_id: "a1", thread_id: "t4", external_id: "x-t4-img", from_addr: "a@b.c", from_name: "Supabase", to_addrs: [], subject: "img", body_text: "", sent_at: ago(230), is_outgoing: false });

  db.rows("drafts").push({ id: "d1", user_id: u, account_id: "a1", thread_id: "t1", to_addrs: ["sarah.mitchell@example.com"], subject: "Re: Q4 deliverables - need your sign-off by Friday", body: "Hi Sarah,\n\nThe mockups will be with you by Thursday noon. I'll flag the legend change so you can review it first.\n\nBest,\nRafay", status: "pending", created_by: "claude", created_at: ago(5) });
  db.rows("drafts").push({ id: "d2", user_id: u, account_id: "a1", thread_id: "t3", to_addrs: ["daniel@example.com"], subject: "Re: Proposal: Phase 2 build", body: "Thanks Daniel, sending the signed copy now.", status: "sent", created_by: "claude", created_at: ago(900) });

  db.rows("clients").push({ id: "c1", user_id: u, name: "Greenbridge" }, { id: "c2", user_id: u, name: "Acme Agency" });
  db.rows("client_rules").push({ id: "r1", user_id: u, client_id: "c1", kind: "domain", pattern: "greenbridge.io" }, { id: "r2", user_id: u, client_id: "c2", kind: "email", pattern: "daniel.okafor@acme-agency.com" });
  for (const [t, c] of [["t2", "c1"], ["t7", "c1"], ["t5", "c2"]]) db.rows("threads").find((x) => x.id === t)!.client_id = c;
  db.rows("accounts").push({ id: "a4", user_id: u, provider: "slack", account_type: "company", display_name: "Greenbridge Workspace", external_id: "T1:U1", status: "connected", can_send: false, last_synced_at: ago(8) });
  db.rows("api_tokens").push({ id: "k1", user_id: u, name: "Cursor", token_hash: "x", prefix: "ubx_Ab12Cd", created_at: ago(600), last_used_at: ago(30), revoked_at: null });
  db.rows("oauth_clients").push({ client_id: "demo-claude", client_name: "Claude", redirect_uris: ["https://claude.example/callback"] });
  db.rows("oauth_tokens").push({ token_hash: "h1", kind: "refresh", client_id: "demo-claude", user_id: u, expires_at: ago(-60 * 24 * 20) });
}

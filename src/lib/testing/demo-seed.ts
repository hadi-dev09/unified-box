// Fake data for `DEMO_MODE=1 npm run dev` (never used in production). Lets the UI be viewed without real accounts.
import type { FakeDb } from "./fake-supabase";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
export const DEMO_USER = { id: "00000000-0000-4000-8000-0000000000d0", email: "demo@example.com" };

export function seedDemo(db: FakeDb) {
  db.user = process.env.DEMO_SIGNED_OUT === "1" ? null : DEMO_USER;
  const u = DEMO_USER.id;
  const accts = [
    { id: "a1", display_name: "rafay.work@gmail.com", label: "Work", account_type: "personal", status: "connected" },
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
  db.rows("accounts").push({ id: "a4", user_id: u, provider: "slack", account_type: "company", display_name: "Greenbridge Workspace", external_id: "T1:U1", status: "connected", can_send: true, last_synced_at: ago(8) });
  db.rows("threads").push({ id: "t11", user_id: u, account_id: "a4", external_id: "C123", subject: "#client-greenbridge", snippet: "Deploy looks good, ship it?", last_message_at: ago(20), unread: true, needs_reply: true, last_from: "Dana", client_id: "c1", starred: true });
  db.rows("messages").push({ id: "m-t11-1", user_id: u, account_id: "a4", thread_id: "t11", external_id: "C123:1", from_addr: "U2", from_name: "Dana", to_addrs: [], subject: "#client-greenbridge", body_text: "Deploy looks good, ship it? @Rafay", sent_at: ago(20), is_outgoing: false });
  // Chat apps: one WhatsApp Business number and one Telegram account, each with a conversation.
  db.rows("accounts").push(
    { id: "a5", user_id: u, provider: "whatsapp", account_type: "company", display_name: "Acme Studio · +92 300 0000000", external_id: "111222333", status: "connected", can_send: true, last_synced_at: ago(1) },
    { id: "a6", user_id: u, provider: "telegram", account_type: "personal", display_name: "@rafay", external_id: "42", status: "connected", can_send: true, last_synced_at: ago(2) },
  );
  db.rows("threads").push(
    { id: "t9", user_id: u, account_id: "a5", external_id: "923001234567", subject: "Sara (Greenbridge)", snippet: "Is the invoice ready? Need it before 5pm", last_message_at: ago(4), unread: true, needs_reply: true, last_from: "Sara (Greenbridge)", client_id: "c1" },
    { id: "t10", user_id: u, account_id: "a6", external_id: "777", subject: "Omar (Client)", snippet: "Can we move tomorrow's call to 4pm?", last_message_at: ago(30), unread: true, needs_reply: true, last_from: "Omar" },
  );
  db.rows("messages").push(
    { id: "m-t9-1", user_id: u, account_id: "a5", thread_id: "t9", external_id: "wamid.d1", from_addr: "+923001234567", from_name: "Sara (Greenbridge)", to_addrs: [], subject: "Sara (Greenbridge)", body_text: "Hi! Quick one", sent_at: ago(6), is_outgoing: false },
    { id: "m-t9-2", user_id: u, account_id: "a5", thread_id: "t9", external_id: "wamid.d2", from_addr: "+923001234567", from_name: "Sara (Greenbridge)", to_addrs: [], subject: "Sara (Greenbridge)", body_text: "Is the invoice ready? Need it before 5pm", sent_at: ago(4), is_outgoing: false },
    { id: "m-t10-1", user_id: u, account_id: "a6", thread_id: "t10", external_id: "777:1", from_addr: "777", from_name: "Omar", to_addrs: [], subject: "Omar (Client)", body_text: "Can we move tomorrow's call to 4pm?", sent_at: ago(30), is_outgoing: false },
  );
  if (process.env.TOKEN_ENCRYPTION_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { encrypt } = require("../crypto") as typeof import("../crypto");
    const tok = encrypt(JSON.stringify({ access_token: "demo", refresh_token: "demo", expires_at: Date.now() + 365 * 86400_000, scope: "x" }));
    db.rows("account_secrets").push({ account_id: "a1", tokens_enc: tok }, { account_id: "a3", tokens_enc: tok }, { account_id: "a4", tokens_enc: tok }, { account_id: "a5", tokens_enc: tok }, { account_id: "a6", tokens_enc: encrypt(JSON.stringify({ session: "demo" })) });
  }
  installDemoNetwork();
  db.rows("api_tokens").push({ id: "k1", user_id: u, name: "Cursor", token_hash: "x", prefix: "ubx_Ab12Cd", created_at: ago(600), last_used_at: ago(30), revoked_at: null });
  db.rows("oauth_clients").push({ client_id: "demo-claude", client_name: "Claude", redirect_uris: ["https://claude.example/callback"] });
  db.rows("oauth_tokens").push({ token_hash: "h1", kind: "refresh", client_id: "demo-claude", user_id: u, expires_at: ago(-60 * 24 * 20) });
}

/** Demo only: pretend sends succeed so every button can be clicked without real accounts or network. */
export function installDemoNetwork() {
  const g = globalThis as unknown as { __TG_FACTORY__?: unknown };
  // Next.js re-patches fetch, so re-wrap whenever our wrapper isn't the current one.
  if ((globalThis.fetch as { __demo?: boolean }).__demo) return;
  const real = globalThis.fetch;
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("gmail.googleapis.com") && url.endsWith("/messages/send")) return ok({ id: `demo-${Date.now()}` });
    if (url.includes("graph.facebook.com") && url.endsWith("/messages")) return ok({ messages: [{ id: `wamid.demo${Date.now()}` }] });
    if (url === "https://api.openai.com/v1/models") return ok({ data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] });
    if (url === "https://api.openai.com/v1/chat/completions") return ok({ choices: [{ message: { content: "Hi Sarah, Thursday works for the review. Thanks!" }, finish_reason: "stop" }] });
    if (url.startsWith("https://api.anthropic.com/v1/models")) return ok({ data: [{ id: "claude-opus-5-5", type: "model" }], has_more: false, first_id: "a", last_id: "a" });
    if (url.startsWith("https://api.anthropic.com/v1/messages")) {
      const ask = String(JSON.parse(String(init?.body ?? "{}")).messages?.[0]?.content ?? "");
      const text = /Draft a reply[\s\S]*<reply>/.test(ask) ? "Here's a reply you can send:\n<reply>Hi Sarah, the mockups will be ready Thursday. Thanks!</reply>"
        : /<inbox/.test(ask) ? "1. Sarah Mitchell, \"Q4 deliverables\": needs your sign-off by Friday.\n2. Greenbridge Accounts: invoice #1042 is overdue." : /Summarize/.test(ask) ? "• Sarah needs mockups signed off by Friday\n• Board review is Monday\nNeeds from you: confirm the delivery date." : /Rewrite my draft/.test(ask) ? "Hi Sarah, the mockups will be ready for your review by Thursday noon. Thanks!" : "Hi Sarah,\n\nThanks for checking in. The mockups will be with you by Thursday, so you'll have time to sign off before Friday.\n\nBest,\nRafay";
      return ok({ id: "msg_demo", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (url.includes("slack.com/api/chat.postMessage")) return ok({ ok: true, ts: `${Math.floor(Date.now() / 1000)}.000100` });
    if (url.includes("slack.com")) return ok({ ok: true, channels: [], messages: [], members: [], response_metadata: {} });
    if (url.includes("googleapis.com") || url.includes("graph.microsoft.com")) return ok({});
    return real(input, init);
  }) as typeof fetch & { __demo?: boolean };
  wrapped.__demo = true;
  globalThis.fetch = wrapped;
  g.__TG_FACTORY__ = async () => ({
    connect: async () => {}, disconnect: async () => {}, saveSession: () => "demo", sendCode: async () => ({ phoneCodeHash: "h" }),
    signIn: async () => "ok" as const, checkPassword: async () => {}, me: async () => ({ id: "42", name: "Rafay", username: "rafay" }),
    dialogs: async () => [{ id: "777", title: "Omar (Client)", unreadCount: 0, isUser: true, isGroup: false, isChannel: false, entity: {}, date: Math.floor(Date.now() / 1000) }],
    messages: async () => [], send: async () => ({ id: Date.now() % 100000, date: Math.floor(Date.now() / 1000) }), logOut: async () => {},
  });
}

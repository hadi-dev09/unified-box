# Unified Box: your checklist

Live app: https://unified-box-eight.vercel.app
Everything below marked **(you)** needs your accounts or your approval. Everything else is already built and automatically tested (55 tests).

## 0. URGENT: fix `CRON_SECRET` (2 minutes)
Two production deploys **failed** because the `CRON_SECRET` value in Vercel contains line breaks (probably two pasted values). The last good version stayed live, so nothing broke for you, but new changes only deploy after this:
- [ ] **(you)** Vercel → project → Settings → Environment Variables → edit `CRON_SECRET` → replace the value with **one single line, no spaces or line breaks** (e.g. the output of one `openssl rand -hex 32`). Save.
- [ ] Then tell me. I'll restore the daily cron in `vercel.json` (it was removed so deploys succeed meanwhile). Also check `TOKEN_ENCRYPTION_KEY` is exactly one line (44 characters ending in `=`).

## 1. Things only you can do

- [ ] **(you) Approve database migration `0004`** (file: `supabase/migrations/0004_perf_and_client_rules.sql`).
  It adds the `client_rules` table (needed for automatic client tagging), indexes, and faster security policies.
  The Supabase tool asked for confirmation because it drops and recreates policies, so it was **not** applied. Run it by pasting the file into Supabase → SQL Editor, or ask me to retry when you're at your desk.
  Until then everything works, but "auto-tag by sender" rules are disabled (you can still create clients and assign threads by hand).
- [ ] **(you) Create the Slack app** (about 5 minutes):
  1. https://api.slack.com/apps → **Create New App → From a manifest** → pick any workspace you own.
  2. Paste the contents of `docs/slack-app-manifest.json` → Create.
  3. **Basic Information** → copy **Client ID** and **Client Secret**.
  4. **Manage Distribution** → activate **public distribution** (needed to install into client workspaces; no Marketplace listing required).
  5. Vercel → project → Settings → Environment Variables: add `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` (Sensitive), then **Redeploy**.
- [ ] **(you) Add every Gmail you want to test** as a Test user in Google Cloud → OAuth consent screen → Audience.
- [ ] **(you, recommended) Fix sign-in email limits**: Supabase's built-in email sender allows only a few emails per hour. Supabase → Authentication → SMTP Settings → add a provider (Resend, Postmark, etc.).

## 2. Test script (tick as you go)

### Sign-in and Gmail
- [ ] Open the app on your phone and laptop, sign in by email link (open the link in the same browser you requested it from).
- [ ] Connect → **Personal · read-only** with an account you added as a test user. The settings page shows "Connected …".
- [ ] Press **Sync**. Threads appear. Open a **newsletter**: you see readable text (this was the blank-message bug).
- [ ] Newsletters / no-reply mail do **not** have the amber "reply" tag. A real person's message does.
- [ ] Filters **Unread** and **Needs reply** work. Counts next to each inbox look right.
- [ ] Times show in **your** timezone.
- [ ] Connect a second Gmail and a **company** account. If the company account is blocked, you see a clear message, not a silent failure.

### Approvals and sending (use a test address you own)
- [ ] Connect one personal account as **read + send**.
- [ ] After step "Claude" below, ask Claude to draft a reply. It appears in **Approvals** as pending, and nothing is sent.
- [ ] Press **Edit**, change the text, **Send edited version**. The email arrives with your edited text.
- [ ] On a **read-only** account, approving fails with a clear "read-only" error and sends nothing.
- [ ] **Reject** really discards the draft.

### Claude connector
- [ ] Claude → Settings → Connectors → Add custom connector → `https://unified-box-eight.vercel.app/api/mcp`.
- [ ] You land on the **Connect Claude** screen listing what it can and cannot do. Approve.
- [ ] Ask: "List my connected accounts", "What needs a reply?", "Search for invoices", "Give me a digest of the last 24 hours".
- [ ] Settings → **Connected apps → Revoke**. Claude loses access immediately.

### Clients
- [ ] Settings → Clients → add a client (e.g. Greenbridge) → add a **domain rule** (`greenbridge.io`). Existing matching threads are tagged; new ones tag on sync.
- [ ] Open a thread → pick a client manually → it sticks after the next Sync.
- [ ] Sidebar (laptop) or chips (phone) filter by client.

### Slack (after you create the app)
- [ ] Settings → **Connect a Slack workspace** → approve in Slack. DMs and channels appear as threads.
- [ ] In a client workspace that blocks apps you should see a message explaining an admin must approve. Send them the approval request.
- [ ] If Slack rate-limits you, the account stays connected and shows a "rate limit … rest sync next time" note.

### Housekeeping
- [ ] **Disconnect** an account: it is removed from the list, its synced messages vanish, and it disappears from Google → Security → Third-party access.
- [ ] Phone: browser menu → **Add to Home Screen**. The app opens full-screen with the inbox icon.

## 3. What is automated (no action needed)
- A refresh when you open the app and the data is older than 5 minutes. (Daily background sync at 04:00 UTC is built (`GET /api/sync`) but switched off until `CRON_SECRET` is fixed, see section 0.)
- Expired OAuth codes/tokens are cleaned up daily.
- Security headers (no framing of the approval screen), rate limit on connector registration.

## 4. Known limits and decisions for you
- **Google "Testing" mode:** Gmail access expires every 7 days; you'll see "Needs reconnect". Fix = Google verification (slow, needs a privacy policy and a security assessment for Gmail scopes). Decide before onboarding other users.
- **Slack rate limits:** Slack restricts history reads for apps distributed outside its Marketplace. Large client workspaces may sync slowly; the app rotates through conversations and never fails silently. Verify Slack's current limits for your case.
- **Slack is read-only** (no sending yet). Gmail sending only through approvals.
- **WhatsApp Business, Upwork, Telegram, LinkedIn** are not built. WhatsApp needs a decision (coexistence vs. API-only number). LinkedIn has no public messaging API.
- **Single region/database**; no team features yet (one person per account).
- **Not tested against real Google/Slack/Supabase from my side:** all flows were tested with realistic fakes. Your run through this checklist is the first real end-to-end test. Report any error text and I'll fix it.

# Unified Box

One inbox for all your client conversations, plus an MCP server so Claude can read them all in one place.

**Phase 1 (this commit):** Gmail (multiple accounts, personal + company), mobile-friendly web UI, read-only MCP server, and an approval queue for replies.
**Planned:** Slack (user tokens), WhatsApp Business (Cloud API, coexistence), Upwork, Telegram, client grouping rules, daily digest.

## Safety model
- Gmail is connected **read-only by default**. Send scope is opt-in per account.
- Claude's MCP tools are read-only plus `draft_reply`, which only creates a *pending* draft.
- Sending happens only at `POST /api/drafts/:id` with a **signed-in human session** (not the MCP key).
- There is no delete tool. All approvals and drafts are written to `audit_log`.
- OAuth tokens are AES-256-GCM encrypted and stored in `account_secrets`, which has no RLS policy (service role only).
- Message bodies are untrusted third-party text; tool output carries a notice telling the model not to follow instructions inside them.
- Account health is always visible (`connected`, `needs_reauth`, `blocked_by_admin`, `error`); company accounts may be blocked by a Workspace admin.

## Setup
1. **Supabase:** create a project, run `supabase/migrations/0001_init.sql` in the SQL editor. Enable Email auth.
2. **Google Cloud:** create a project, enable the Gmail API, configure the OAuth consent screen, create an OAuth *Web* client with redirect URI `{APP_URL}/api/connect/gmail/callback`. While the app is in "Testing", add your own Gmail addresses as test users (note: refresh tokens expire after 7 days in Testing mode; a public product needs Google verification and a security assessment for restricted Gmail scopes).
3. Copy `.env.example` to `.env.local` and fill it in. Generate secrets with `openssl rand -base64 32` (TOKEN_ENCRYPTION_KEY) and `openssl rand -hex 32` (CRON_SECRET). Run migrations 0001 and 0002. In Supabase → Authentication → URL Configuration, set Site URL and add `{APP_URL}/auth/callback` to Redirect URLs.
4. `npm install && npm run dev`, or deploy to Vercel with the same env vars (needed for phone access).
5. Add the app to your phone's home screen. Optionally schedule `POST /api/sync` with `Authorization: Bearer $CRON_SECRET`.

## Connect Claude (one-click OAuth)
In Claude: Settings → Connectors → Add custom connector → URL `{APP_URL}/api/mcp`.
Claude discovers the OAuth endpoints, you sign in, see a consent screen listing exactly what it can do, and click Approve. No keys to copy.
Implements OAuth 2.1: dynamic client registration, PKCE (S256 only), single-use codes, hashed tokens, 1h access tokens and rotating 30-day refresh tokens with replay detection. Revoke any time under Connect accounts → Connected apps.
Tools: `list_accounts`, `list_threads`, `get_thread`, `search_messages`, `daily_digest`, `draft_reply`.

## Known limits (v1)
- Sign-in is an email magic link: open it in the same browser you requested it from. Supabase's built-in email sender is heavily rate-limited; configure custom SMTP or Google sign-in before real use.
- Sync is a manual/scheduled poll of the last 14 days (max 50 messages per account); no Pub/Sub push yet.
- Plain-text bodies only.

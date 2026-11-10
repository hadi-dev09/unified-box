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
3. Copy `.env.example` to `.env.local` and fill it in. Generate secrets with `openssl rand -base64 32` (TOKEN_ENCRYPTION_KEY) and `openssl rand -hex 32` (MCP_API_KEY, CRON_SECRET). `MCP_USER_ID` is your user id from Supabase Auth → Users after your first login.
4. `npm install && npm run dev`, or deploy to Vercel with the same env vars (needed for phone access).
5. Add the app to your phone's home screen. Optionally schedule `POST /api/sync` with `Authorization: Bearer $CRON_SECRET`.

## Connect Claude
Add `{APP_URL}/api/mcp` as a remote MCP server with header `Authorization: Bearer <MCP_API_KEY>`.
Tools: `list_accounts`, `list_threads`, `get_thread`, `search_messages`, `daily_digest`, `draft_reply`.

## Known limits (v1)
- Single-user MCP auth (one env-configured key). Multi-user keys and OAuth for MCP come before any public launch.
- Sync is a manual/scheduled poll of the last 14 days (max 50 messages per account); no Pub/Sub push yet.
- Plain-text bodies only.

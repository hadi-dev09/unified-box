# Unified Box: what's done and your setup checklist

Live app: https://unified-box-eight.vercel.app
Rule for every key or secret: paste it **only** into Vercel or into the app's Settings page, never into a chat.
"Redeploy" always means: Vercel → project **unified-box** → **Deployments** → **⋯** on the top one → **Redeploy**.

---

## Part A: What's built and live

| Area | What you get |
|---|---|
| Inbox | Gmail + Slack in one list, grouped sidebar by app (Gmail / Slack / …) with accounts underneath, rename any account, coloured channel tags, 01:02 PM times |
| Speed & sync | Pages load next to the database; loading bar on every click; server checks every inbox **every minute**, even when the app is closed |
| Actions | Read/unread, star, snooze, delete/restore, select many at once; tabs for Unread, Needs reply, Starred, Snoozed, Trash |
| Search | Results appear as you type, Enter for all, ✕ to clear |
| Replies | Reply, Reply all, Forward (email); message box for Slack/WhatsApp/Telegram |
| **Schedule send** | Clock button next to Send: in 3 hours, tomorrow morning/afternoon, Monday, or any date/time. The conversation shows "Scheduled for …" with **Send now** / **Cancel**; all scheduled messages are in **Drafts & scheduled → Scheduled** |
| **AI assistant (own key)** | In every reply box: **Write with AI**, Shorter, More formal, Friendlier, Fix grammar, Undo; **Summarize** on every conversation. Works with a **Claude or OpenAI** API key. AI never sends; you press Send |
| AI apps (Claude, ChatGPT) | Connect once; they can read, search, summarise, organise (groups, read/unread, star, snooze, rename) and draft. They can **never** send or delete. ChatGPT is confirmed connected |
| Clients | Client groups with automatic tagging by domain or email |
| Accounts | Sign up with Google (also connects that Gmail) or email; light/dark/system theme |
| Built, waiting for keys | WhatsApp Business, Telegram, Outlook |

Tests: 119 automated tests + 37 browser click-through checks pass.

---

## Part B: Your checklist (in order)

### ☐ 1. Slack: instant messages + replies (about 5 min)
Why: Slack only lets apps like ours poll old messages once per minute, so without this Slack can lag up to 10 minutes. With it, messages arrive instantly.
1. Open https://api.slack.com/apps → click your **Unified Box** app.
2. Left menu **Basic Information** → **App Credentials** → **Signing Secret** → **Show** → copy it.
3. Vercel → unified-box → **Settings → Environment Variables** → **Add**:
   Key `SLACK_SIGNING_SECRET`, Value = the signing secret, Environment **Production**, mark **Sensitive** → Save.
4. **Redeploy** and wait until it says Ready (about 1 minute).
5. Back in Slack: left menu **App Manifest** → switch to **JSON** → replace everything with the contents of
   `docs/slack-app-manifest.json` (it adds replies + real-time events) → **Save Changes**.
   If Slack shows "URL didn't respond", step 4 wasn't finished yet: wait a minute and save again.
6. If Slack shows a yellow banner "reinstall your app", click it and approve.
7. In Unified Box → **Settings** → under Slack click **Connect Slack** (read + reply) → approve.
8. Test: send yourself a Slack message from another device. It should appear in Unified Box within seconds.

### ☐ 2. Gmail mirroring (1 minute per Gmail)
Why: so read/unread, star and delete in Unified Box also happen in your real Gmail.
1. Unified Box → **Settings** → **Your channels**.
2. Next to each Gmail, click **Upgrade access** → choose the same Google account → tick every box → **Continue**.
3. The Gmail card should now show **✓ Read · ✓ Send · ✓ Manage**.
4. Test: mark a message unread in Unified Box → it turns bold in Gmail within a few seconds.

### ☐ 3. AI assistant (2 minutes)
Pick **one**:
- **Claude:** https://console.anthropic.com → **Settings → Billing** (add a little credit, e.g. $5) → **API keys** → **Create key** → copy (starts with `sk-ant-`).
- **OpenAI:** https://platform.openai.com → **Settings → Billing** (add credit) → **API keys** → **Create new secret key** → copy (starts with `sk-`).
  A ChatGPT Plus subscription is **not** an API key.

Then Unified Box → **Settings → AI assistant** → choose **Claude** or **OpenAI** → paste → **Save key**.
You should see "connected · key …abcd". Open any conversation → **Reply** → **Write with AI**.

### ☐ 4. Telegram (5 minutes, when my.telegram.org lets you in)
1. Turn the VPN **off** and try https://my.telegram.org in a private window (the website sometimes works in Pakistan even when the app is blocked). If it doesn't load, use a VPN server in Germany, the Netherlands or the UK (not US/"streaming" servers).
2. Log in with your phone number → the code arrives **inside the Telegram app**.
3. **API development tools** → App title `Unified Box`, short name like `unifiedbox` + a few random letters, platform **Web** → **Create application** (click **once**; if "too many attempts", stop and try tomorrow).
4. Copy **api_id** and **api_hash** → Vercel: `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` (Production) → **Redeploy**.
5. Unified Box → **Settings → Telegram → Connect Telegram** → phone number → code from the Telegram app → (two-step password if you set one).

### ☐ 5. WhatsApp Business via Meta (20–30 minutes)
Read first: Meta's API works with a **WhatsApp Business number**, not your personal WhatsApp. Start with Meta's free **test number**.
1. https://developers.facebook.com/apps → **Create app** → use case **Other** → type **Business** → add the **WhatsApp** product.
   (If asked for a business portfolio, create a free one.)
2. **App settings → Basic** → copy **App secret** → Vercel `WHATSAPP_APP_SECRET`.
3. Make up a long random password-like string (40+ letters and numbers) → Vercel `WHATSAPP_VERIFY_TOKEN`.
4. **Redeploy** and wait for Ready.
5. Meta: **WhatsApp → Configuration → Webhook → Edit** →
   Callback URL `https://unified-box-eight.vercel.app/api/webhooks/whatsapp`, Verify token = your string from step 3 → **Verify and save** → under **Webhook fields** subscribe to **messages**.
6. **WhatsApp → API Setup**: note the **Phone number ID** and **WhatsApp Business Account ID**; under "To", add your own phone number so you can message the test number.
7. Token: for a quick test, copy the temporary token on API Setup (lasts 24 hours). For permanent use: https://business.facebook.com/settings → **Users → System users** → Add (Admin) → **Add assets** (the app + WhatsApp account, full control) → **Generate token** with `whatsapp_business_messaging` and `whatsapp_business_management`.
8. Unified Box → **Settings → WhatsApp Business → Connect WhatsApp** → paste Phone number ID, Business Account ID, token.
9. Test: from your phone, send a WhatsApp message **to the test number** → it appears in Unified Box within seconds → reply from Unified Box (works within 24 hours of their last message).

### ☐ 6. Outlook / Microsoft 365 (later, about 10 minutes once you have an Azure account)
You need a Microsoft directory to register an app. Free options: **Azure free account** (https://azure.microsoft.com/free, card used only for identity) or the **Microsoft 365 Developer Program** (if eligible).
1. https://entra.microsoft.com (or https://portal.azure.com → search "App registrations") → **App registrations → New registration**.
2. Name `Unified Box`; account types: **Accounts in any organizational directory and personal Microsoft accounts**; Redirect URI **Web**: `https://unified-box-eight.vercel.app/api/connect/outlook/callback` → **Register**.
3. Copy **Application (client) ID** → Vercel `MICROSOFT_CLIENT_ID`.
4. **Certificates & secrets → New client secret** (24 months) → copy the **Value** → Vercel `MICROSOFT_CLIENT_SECRET`.
5. **Redeploy** → Unified Box → **Settings → Outlook → Connect Outlook**.

---

## Part C: Later (before selling; nothing to do now)
- **Your own email service for sign-up emails** (e.g. Resend or Postmark) + your own domain → then sign-up emails can include both a link and a code, without the hourly limit.
- **Google verification** of the Gmail app (needed before people outside your test-user list can sign in; reading Gmail requires a paid security assessment). Start early: it takes weeks.
- **Slack Marketplace** listing (removes Slack's slow-history limit and the "unapproved app" warning in client workspaces).
- **Meta business verification + "Embedded Signup"** (one-click WhatsApp connect for customers, keeps their WhatsApp Business app working).
- **Microsoft publisher verification** (so company Outlook accounts can approve the app).
- **Telegram:** works per user already; nothing extra.
- Optional: a built-in, paid AI plan (you provide the AI, customers pay monthly) instead of "bring your own key".

# Connecting Outlook, WhatsApp, Telegram and Slack

All code is built and tested. Each connector shows **"Coming soon"** on *Accounts & settings* until its
keys are added in Vercel (Project → Settings → Environment Variables → Production), followed by a redeploy.
Do them in any order; each one is independent.

App URL used below: `https://unified-box-eight.vercel.app` (change it if you add your own domain).

---

## 1. Outlook / Microsoft 365  (≈10 min)

1. Go to <https://entra.microsoft.com> → **App registrations** → **New registration**.
   - Name: `Unified Box`
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
   - Redirect URI: platform **Web**, `https://unified-box-eight.vercel.app/api/connect/outlook/callback`
2. On the app's **Overview**, copy **Application (client) ID** → Vercel `MICROSOFT_CLIENT_ID`.
3. **Certificates & secrets** → **New client secret** → copy the **Value** (not the ID) → Vercel `MICROSOFT_CLIENT_SECRET`.
   Note the expiry date; the connector stops working when it expires.
4. **API permissions** → Add → Microsoft Graph → **Delegated**: `Mail.Read`, `Mail.Send`, `User.Read`,
   `offline_access`, `openid`, `email`, `profile`.
5. Redeploy in Vercel. Then: *Accounts & settings → Outlook → Connect*.

Limits:
- Many companies only let their staff approve apps from a **verified publisher**, or require an IT admin to approve.
  The app shows a clear message when that happens. To sell to companies, complete Microsoft Publisher Verification (needs a Microsoft Partner Network ID).
- Personal Outlook.com/Hotmail accounts work straight away.

---

## 2. WhatsApp Business (Cloud API)  (≈20–30 min)

**Important (please read):** Meta's official API works with **WhatsApp Business numbers**, not with the
normal personal WhatsApp app. A number that is moved onto the Cloud API generally stops working in the normal app.
Meta also offers "coexistence" (keep using the WhatsApp Business **app** on the same number), but only
through Meta's Embedded Signup for approved Tech Providers, which is a later step for selling the product.
For testing, use Meta's free **test number**.

1. <https://developers.facebook.com/apps> → **Create app** → use case **Other** → type **Business** → add the **WhatsApp** product.
2. **App settings → Basic** → copy **App secret** → Vercel `WHATSAPP_APP_SECRET`.
3. Make up a long random string (e.g. run `openssl rand -hex 24`) → Vercel `WHATSAPP_VERIFY_TOKEN`.
4. Redeploy in Vercel (the webhook must be live before the next step).
5. **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://unified-box-eight.vercel.app/api/webhooks/whatsapp`
   - Verify token: the same string as step 3 → **Verify and save**
   - Under **Webhook fields**, subscribe to **messages**.
6. **WhatsApp → API Setup**: note the **Phone number ID** and **WhatsApp Business Account ID**.
   With the test number, add your own phone under "To" so you can message it.
7. Permanent token: <https://business.facebook.com/settings> → **Users → System users** → Add (Admin) →
   **Add assets** (your app and the WhatsApp account, full control) → **Generate token** for the app with
   `whatsapp_business_messaging` and `whatsapp_business_management`. (The 24-hour token on API Setup also works for a quick test.)
8. In Unified Box: *Accounts & settings → WhatsApp Business → Connect WhatsApp* → paste Phone number ID, Business Account ID and the token.
9. Send a WhatsApp message **to** the business number from your phone. It appears in the inbox within seconds.

Limits:
- Replies are free-form only within **24 hours** of the customer's last message (Meta rule). After that, Meta requires approved templates; the app shows a clear error.
- Only new messages arrive (Meta has no API for chat history).
- Photos, voice notes and files show as labels such as "📷 Photo: caption". The media itself is not downloaded yet.

---

## 3. Telegram  (≈5 min)

1. <https://my.telegram.org> → log in with your phone → **API development tools** → create an app (any name/URL).
2. Copy **api_id** → Vercel `TELEGRAM_API_ID`, and **api_hash** → Vercel `TELEGRAM_API_HASH`. Redeploy.
3. In Unified Box: *Accounts & settings → Telegram → Connect Telegram* → phone number → code (it arrives **inside the Telegram app**, not by SMS) → two-step password if you set one.

Limits:
- Reads your recent private chats and groups (last 14 days); broadcast channels are skipped.
- Unified Box appears under Telegram → Settings → Devices; ending it there disconnects the app. Disconnecting in Unified Box also logs that session out.
- Telegram watches for automated use of personal accounts. Normal use (reading, replying by hand) is fine. Don't use it for bulk messaging.

---

## 4. Slack  (≈10 min)

See `docs/slack-app-manifest.json` and the Slack section of `CHECKLIST.md`: create an app from the manifest, then copy
**Client ID / Client Secret** → Vercel `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`, then redeploy. Each user chooses **read + reply** (replies are posted as them, using Slack's `chat:write` user permission) or read-only when connecting.
In client workspaces, an admin may need to approve the app.

---

## What's on the roadmap and why

| Channel | Status | Notes |
|---|---|---|
| Microsoft Teams | Planned | Microsoft Graph; most companies require admin approval for chat access. |
| SMS | Planned | Through a Twilio number (business texting). |
| Instagram DMs / Facebook Messenger | Planned | Same Meta app as WhatsApp; needs Meta App Review for public use. |
| Upwork | Planned | Upwork's API requires an application and approval from Upwork. |
| Google Chat | Planned | Workspace accounts only. |
| Discord | Planned | Bot in servers only; Discord doesn't allow reading personal DMs. |
| LinkedIn messages | Not possible | LinkedIn has no messaging API for apps like this. "Open in LinkedIn" only. |

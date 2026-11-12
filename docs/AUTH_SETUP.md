# Sign-in setup (Supabase dashboard): about 10 minutes

The app code for password sign-in, sign-up, email codes, forgot/reset password and Google/Slack sign-in is done.
These settings live in your Supabase dashboard, so they need you. Project: **unified-box**.

## 1. URL configuration (required)
Authentication → URL Configuration → **Redirect URLs** → Add:
```
https://unified-box-eight.vercel.app/**
```
(Keep the Site URL as `https://unified-box-eight.vercel.app`.)

## 2. Email confirmation (required)
Authentication → Sign In / Providers → **Email**:
- Enable Email provider: on
- Confirm email: **on**
- Minimum password length: **8**

## 3. Email templates (required for codes and any-device links)
Authentication → Emails → Templates. Replace the body of each template below and **Save**.
These make every email contain a 6-digit code *and* a link that works on any device or browser.

**Confirm signup**
```html
<h2>Confirm your Unified Box account</h2>
<p>Your code is <strong style="font-size:20px;letter-spacing:4px">{{ .Token }}</strong></p>
<p>Or <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/">confirm with one click</a>. It works on any device.</p>
```

**Magic link** (used by "Email code" sign-in)
```html
<h2>Your Unified Box sign-in code</h2>
<p><strong style="font-size:20px;letter-spacing:4px">{{ .Token }}</strong></p>
<p>Or <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/">sign in with one click</a>.</p>
<p>If you didn't ask for this, you can ignore this email.</p>
```

**Reset password**
```html
<h2>Reset your Unified Box password</h2>
<p>Your code is <strong style="font-size:20px;letter-spacing:4px">{{ .Token }}</strong></p>
<p>Or <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">choose a new password</a>.</p>
<p>If you didn't ask for this, you can ignore this email.</p>
```

## 4. Email sending limits (strongly recommended)
Supabase's built-in email sender only allows a few emails per hour, so sign-up and reset codes will fail beyond that.
Authentication → Emails → **SMTP Settings** → enable custom SMTP with a provider such as Resend, Postmark or SendGrid.

## 5. "Continue with Google" (optional)
The button appears automatically once Google is enabled in Supabase.
1. Google Cloud Console. Recommended: a **separate project** just for sign-in (only basic scopes: email, profile).
   Your Gmail project uses restricted Gmail scopes, which makes publishing it to all users much harder.
2. APIs & Services → OAuth consent screen: External, app name "Unified Box", add your support email.
3. Credentials → Create OAuth client → **Web application** → Authorized redirect URI:
   ```
   https://nkksdfkzzysoyaycykto.supabase.co/auth/v1/callback
   ```
4. Supabase → Authentication → Sign In / Providers → **Google** → enable → paste Client ID and Client secret → Save.
5. While the consent screen is in "Testing", only test users can use Google sign-in. Publish it when ready
   (for basic scopes Google normally only reviews your app's branding, but check the console's current requirements).

## 6. "Continue with Slack" (optional)
1. In your Slack app (api.slack.com/apps) → OAuth & Permissions → add Redirect URL
   `https://nkksdfkzzysoyaycykto.supabase.co/auth/v1/callback`, and add user scopes `openid`, `email`, `profile`.
2. Supabase → Authentication → Sign In / Providers → **Slack (OIDC)** → enable → paste the Slack app's Client ID and Secret.
The button appears automatically once enabled.

## 7. Optional hardening
- Authentication → Sign In / Providers → Email → **Leaked password protection** (may require a paid plan).

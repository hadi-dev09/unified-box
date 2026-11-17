// One place that describes every communication channel: drives the Accounts page, composer and sync.

export type ProviderId =
  | "gmail" | "outlook" | "slack" | "whatsapp" | "whatsapp_web" | "imap" | "telegram"
  | "teams" | "sms" | "instagram" | "messenger" | "upwork" | "discord" | "google_chat" | "linkedin";

export type Provider = {
  id: ProviderId;
  name: string;
  kind: "email" | "chat";
  /** live = connectable now; planned = on the roadmap; unavailable = no official API for this use. */
  stage: "live" | "planned" | "unavailable";
  canReply: boolean;
  blurb: string;
  /** Env vars the server needs before people can connect (set once by the app owner). */
  env: string[];
};

export const PROVIDERS: Provider[] = [
  { id: "gmail", name: "Gmail", kind: "email", stage: "live", canReply: true, env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    blurb: "Personal Gmail and Google Workspace accounts." },
  { id: "outlook", name: "Outlook / Microsoft 365", kind: "email", stage: "live", canReply: true, env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    blurb: "Outlook.com, Hotmail and Microsoft 365 work accounts." },
  { id: "whatsapp_web", name: "WhatsApp (scan QR)", kind: "chat", stage: "live", canReply: true, env: ["WA_GATEWAY_URL", "WA_GATEWAY_KEY", "WA_GATEWAY_WEBHOOK_SECRET"],
    blurb: "Your normal WhatsApp or WhatsApp Business app, linked like WhatsApp Web by scanning a QR code. Unofficial: see the risk note." },
  { id: "imap", name: "Email with app password", kind: "email", stage: "live", canReply: true, env: ["TOKEN_ENCRYPTION_KEY"],
    blurb: "Gmail, Yahoo, iCloud, Zoho, Fastmail or your own domain using an app password. No Google app or verification needed." },
  { id: "whatsapp", name: "WhatsApp Business", kind: "chat", stage: "live", canReply: true, env: ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"],
    blurb: "Customer chats on a WhatsApp Business number (Cloud API). Replies within 24h of the customer's last message." },
  { id: "telegram", name: "Telegram", kind: "chat", stage: "live", canReply: true, env: ["TELEGRAM_API_ID", "TELEGRAM_API_HASH"],
    blurb: "Your personal Telegram chats, signed in with your phone number." },
  { id: "slack", name: "Slack", kind: "chat", stage: "live", canReply: true, env: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    blurb: "Channels and DMs you can see, in your own and clients' workspaces. Replies are posted as you." },
  { id: "teams", name: "Microsoft Teams", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Teams chats via Microsoft Graph (many companies require admin approval)." },
  { id: "sms", name: "SMS / phone", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Business text messages through a Twilio number." },
  { id: "instagram", name: "Instagram DMs", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Direct messages for Instagram professional accounts (Meta app review)." },
  { id: "messenger", name: "Facebook Messenger", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Messages to your Facebook Page (Meta app review)." },
  { id: "upwork", name: "Upwork", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Upwork client messages (requires Upwork API approval)." },
  { id: "google_chat", name: "Google Chat", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Google Workspace chat spaces and DMs." },
  { id: "discord", name: "Discord", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Server channels through a Discord bot (personal DMs aren't allowed by Discord)." },
  { id: "linkedin", name: "LinkedIn messages", kind: "chat", stage: "unavailable", canReply: false, env: [],
    blurb: "LinkedIn doesn't offer a messaging API to apps like this one. Use “Open in LinkedIn” instead." },
];

export const provider = (id: string | null | undefined) => PROVIDERS.find((p) => p.id === id);
export const isConfigured = (p: Provider) => p.env.length > 0 && p.env.every((k) => Boolean(process.env[k]));
export const isEmailProvider = (id: string | null | undefined) => provider(id)?.kind === "email";
export const canReply = (id: string | null | undefined) => Boolean(provider(id)?.canReply);

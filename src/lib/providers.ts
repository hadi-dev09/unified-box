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
    blurb: "Gmail and Google Workspace. Sign in with Google and allow access." },
  { id: "outlook", name: "Outlook", kind: "email", stage: "live", canReply: true, env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    blurb: "Outlook.com, Hotmail and Microsoft 365. Sign in with Microsoft and allow access." },
  { id: "whatsapp_web", name: "WhatsApp", kind: "chat", stage: "live", canReply: true, env: ["WA_GATEWAY_URL", "WA_GATEWAY_KEY", "WA_GATEWAY_WEBHOOK_SECRET"],
    blurb: "Your WhatsApp or WhatsApp Business app. Scan a QR code with your phone, just like WhatsApp Web." },
  { id: "imap", name: "Yahoo & other email", kind: "email", stage: "live", canReply: true, env: ["UNIPILE_DSN", "UNIPILE_API_KEY"],
    blurb: "Yahoo, iCloud, Zoho, your company or own-domain mailbox." },
  { id: "whatsapp", name: "WhatsApp Business API", kind: "chat", stage: "live", canReply: true, env: ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"],
    blurb: "A number on Meta's WhatsApp Cloud API. Replies within 24h of the customer's last message." },
  { id: "telegram", name: "Telegram", kind: "chat", stage: "live", canReply: true, env: ["TELEGRAM_API_ID", "TELEGRAM_API_HASH"],
    blurb: "Your Telegram chats. Sign in with your phone number." },
  { id: "slack", name: "Slack", kind: "chat", stage: "live", canReply: true, env: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"],
    blurb: "Channels and DMs you can see, in your own and clients' workspaces. Replies are posted as you." },
  { id: "teams", name: "Microsoft Teams", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Teams chats via Microsoft Graph (many companies require admin approval)." },
  { id: "sms", name: "SMS / phone", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Business text messages through a Twilio number." },
  { id: "instagram", name: "Instagram", kind: "chat", stage: "live", canReply: true, env: ["UNIPILE_DSN", "UNIPILE_API_KEY"], blurb: "Your Instagram direct messages." },
  { id: "messenger", name: "Messenger", kind: "chat", stage: "live", canReply: true, env: ["UNIPILE_DSN", "UNIPILE_API_KEY"], blurb: "Your Facebook Messenger chats." },
  { id: "upwork", name: "Upwork", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Upwork client messages (requires Upwork API approval)." },
  { id: "google_chat", name: "Google Chat", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Google Workspace chat spaces and DMs." },
  { id: "discord", name: "Discord", kind: "chat", stage: "planned", canReply: false, env: [], blurb: "Server channels through a Discord bot (personal DMs aren't allowed by Discord)." },
  { id: "linkedin", name: "LinkedIn", kind: "chat", stage: "live", canReply: true, env: ["UNIPILE_DSN", "UNIPILE_API_KEY"], blurb: "Your LinkedIn messages." },
];

export const provider = (id: string | null | undefined) => PROVIDERS.find((p) => p.id === id);
export const isConfigured = (p: Provider) => p.env.length > 0 && p.env.every((k) => Boolean(process.env[k]));
export const isEmailProvider = (id: string | null | undefined) => provider(id)?.kind === "email";
export const canReply = (id: string | null | undefined) => Boolean(provider(id)?.canReply);

const unipileOn = () => Boolean(process.env.UNIPILE_DSN && process.env.UNIPILE_API_KEY);
const VIA_UNIPILE = new Set(["gmail", "outlook", "imap", "whatsapp_web", "telegram", "instagram", "messenger", "linkedin"]);

/** How a channel is connected right now: through the hosted sign-in page, our own sign-in, a form, or not at all. */
export function connectMethod(id: ProviderId): "hosted" | "oauth" | "form" | null {
  if (unipileOn() && VIA_UNIPILE.has(id)) return "hosted";
  const p = provider(id);
  if (!p || p.stage !== "live" || !isConfigured(p)) return null;
  return id === "gmail" || id === "outlook" || id === "slack" ? "oauth" : "form";
}

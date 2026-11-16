import { createHmac, timingSafeEqual } from "node:crypto";
import { decrypt } from "./crypto";
import type { GmailMsg } from "./gmail";
import { supabaseAdmin } from "./supabase/admin";

// WhatsApp Business Platform (Cloud API). Incoming messages arrive on our webhook; replies go through the Graph API.
const GRAPH = "https://graph.facebook.com/v21.0";

export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);

/** Meta signs webhook bodies with the app secret (X-Hub-Signature-256: sha256=<hex>). */
export function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("hex"));
  const got = Buffer.from(header.slice(7));
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function waGraph(token: string, path: string, init?: RequestInit) {
  const r = await fetch(`${GRAPH}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = j?.error?.code;
    if (code === 131047 || code === 131026) throw new Error("WhatsApp only allows free-form replies within 24 hours of the customer's last message. Ask them to message you first, or use an approved template from WhatsApp Manager.");
    if (code === 190 || r.status === 401) throw new Error("WhatsApp access token is invalid or expired. Reconnect WhatsApp with a permanent (System User) token.");
    throw new Error(`WhatsApp ${r.status}: ${j?.error?.message ?? "request failed"}`);
  }
  return j;
}

export async function waNumberInfo(phoneNumberId: string, token: string) {
  const j = await waGraph(token, `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`);
  return { display: String(j.display_phone_number ?? ""), name: String(j.verified_name ?? "WhatsApp Business") };
}

export async function waSubscribe(wabaId: string, token: string) {
  await waGraph(token, `/${encodeURIComponent(wabaId)}/subscribed_apps`, { method: "POST" });
}

async function tokenFor(accountId: string) {
  const { data } = await supabaseAdmin().from("account_secrets").select("tokens_enc").eq("account_id", accountId).single();
  if (!data) throw new Error("No stored token");
  return (JSON.parse(decrypt(data.tokens_enc)) as { access_token: string }).access_token;
}

export async function waSend(accountId: string, phoneNumberId: string, to: string, text: string) {
  const j = await waGraph(await tokenFor(accountId), `/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: true } }),
  });
  return { id: String(j?.messages?.[0]?.id ?? `wa-out-${Date.now()}`) };
}

type WaMessage = { id: string; from: string; timestamp: string; type: string; text?: { body?: string }; [k: string]: unknown };
type WaChange = { value?: { metadata?: { phone_number_id?: string }; contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: WaMessage[] } };

const describe = (m: WaMessage) => {
  if (m.type === "text") return m.text?.body ?? "";
  const media = m[m.type] as { caption?: string } | undefined;
  const label: Record<string, string> = { image: "📷 Photo", video: "🎥 Video", audio: "🎤 Voice message", document: "📄 Document", sticker: "Sticker", location: "📍 Location", contacts: "👤 Contact", reaction: "Reaction" };
  return [label[m.type] ?? `[${m.type}]`, media?.caption].filter(Boolean).join(": ");
};

/** Turns a webhook payload into per-number, per-customer message batches. */
export function parseWebhook(body: unknown): { phoneNumberId: string; waId: string; name: string; msgs: GmailMsg[] }[] {
  const out: { phoneNumberId: string; waId: string; name: string; msgs: GmailMsg[] }[] = [];
  const entries = ((body as { entry?: { changes?: WaChange[] }[] })?.entry ?? []);
  for (const e of entries) for (const ch of e.changes ?? []) {
    const v = ch.value; const pid = v?.metadata?.phone_number_id;
    if (!pid || !v?.messages?.length) continue;
    for (const m of v.messages) {
      const contact = v.contacts?.find((c) => c.wa_id === m.from);
      const name = contact?.profile?.name || `+${m.from}`;
      const text = describe(m);
      let batch = out.find((b) => b.phoneNumberId === pid && b.waId === m.from);
      if (!batch) { batch = { phoneNumberId: pid, waId: m.from, name, msgs: [] }; out.push(batch); }
      batch.msgs.push({
        id: m.id, threadId: m.from, subject: name, fromName: name, fromAddr: `+${m.from}`, to: [], cc: [], messageId: "",
        body: text, sentAt: new Date(Number(m.timestamp) * 1000).toISOString(), snippet: text.slice(0, 200), unread: true, outgoing: false, automated: false,
      });
    }
  }
  return out;
}

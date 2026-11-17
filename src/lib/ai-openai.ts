// OpenAI (ChatGPT API) support for the in-app assistant, for people who bring an OpenAI key instead of a Claude key.
const BASE = "https://api.openai.com/v1";

export const openAiKeyShape = (k: string) => /^sk-(?!ant-)[A-Za-z0-9_-]{20,300}$/.test(k);

function friendly(status: number, body: { error?: { code?: string; type?: string } }) {
  const code = body.error?.code ?? body.error?.type ?? "";
  if (status === 401) return "OpenAI rejected this API key. Check it in Settings → AI assistant.";
  if (code === "insufficient_quota") return "Your OpenAI account has no credit left. Add billing at platform.openai.com.";
  if (status === 429) return "Your OpenAI account hit its rate limit. Try again in a moment.";
  if (status === 403) return "This OpenAI key isn't allowed to use that model.";
  if (status >= 500) return "OpenAI is having problems right now. Try again in a moment.";
  return `OpenAI error (${status}).`;
}

/**
 * Picks a general-purpose chat model the key can actually use (newest GPT generation first; the full model
 * before "mini"), so we never hard-code a model name that may not exist for this account.
 */
export function pickOpenAiModel(ids: string[]): string | null {
  const chat = ids.filter((id) => /^gpt-\d/.test(id) && !/(audio|realtime|transcribe|tts|image|search|codex|instruct|nano|preview|\d{4}-\d{2}-\d{2})/.test(id));
  const ver = (id: string) => Number((id.match(/^gpt-(\d+(?:\.\d+)?)/) ?? [])[1] ?? 0);
  chat.sort((a, b) => ver(b) - ver(a) || Number(/mini/.test(a)) - Number(/mini/.test(b)) || a.length - b.length);
  return chat[0] ?? null;
}

export async function validateOpenAiKey(key: string): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  const k = key.trim();
  if (!openAiKeyShape(k)) return { ok: false, error: "That doesn't look like an OpenAI API key (it starts with sk-)." };
  try {
    const r = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15_000) });
    const j = (await r.json().catch(() => ({}))) as { data?: { id: string }[]; error?: { code?: string } };
    if (!r.ok) return { ok: false, error: friendly(r.status, j) };
    const model = pickOpenAiModel((j.data ?? []).map((m) => m.id));
    return model ? { ok: true, model } : { ok: false, error: "This OpenAI key has no chat model available." };
  } catch {
    return { ok: false, error: "Couldn't reach OpenAI. Check your connection and try again." };
  }
}

/** One chat completion. Returns text, or a plain-English error. */
export async function openAiComplete(key: string, model: string, system: string, user: string): Promise<{ ok: true; text: string; truncated: boolean } | { ok: false; error: string; badKey?: boolean }> {
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, max_completion_tokens: 4000, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = (await r.json().catch(() => ({}))) as { choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]; error?: { code?: string } };
    if (!r.ok) return { ok: false, error: friendly(r.status, j), badKey: r.status === 401 };
    const c = j.choices?.[0];
    if (c?.message?.refusal) return { ok: false, error: "The AI declined to help with this conversation." };
    const text = (c?.message?.content ?? "").trim();
    if (!text) return { ok: false, error: "The AI returned an empty answer. Try again." };
    return { ok: true, text, truncated: c?.finish_reason === "length" };
  } catch {
    return { ok: false, error: "Couldn't reach OpenAI. Check your connection and try again." };
  }
}

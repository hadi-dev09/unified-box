"use server";
import { revalidatePath } from "next/cache";
import { setThreadClient } from "@/lib/clients";
import { cookies } from "next/headers";
import { currentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { markSeen } from "@/lib/threads";

async function uid() {
  return (await currentUser())?.id ?? null;
}

/** Gives a connected account a friendly name (e.g. a client's name). Empty resets to the address. */
export async function renameAccountAction(accountId: string, label: string) {
  const u = await uid();
  if (!u || typeof accountId !== "string") return { ok: false };
  const clean = String(label ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const { error } = await supabaseAdmin().from("accounts").update({ label: clean || null }).eq("id", accountId).eq("user_id", u);
  revalidatePath("/", "layout");
  return { ok: !error };
}

/** Remembers the theme choice (light / dark / system) in a cookie so the server renders it without a flash. */
export async function setThemeAction(theme: string) {
  const t = ["light", "dark", "system"].includes(theme) ? theme : "system";
  (await cookies()).set("ub_theme", t, { path: "/", maxAge: 31536000, sameSite: "lax" });
}

export async function markSeenAction(threadId: string) {
  const u = await uid();
  if (!u || typeof threadId !== "string") return;
  await markSeen(u, threadId);
  revalidatePath("/");
}

export async function assignClientAction(form: FormData) {
  const u = await uid();
  if (!u) return;
  const client = String(form.get("client") ?? "");
  await setThreadClient(u, String(form.get("thread") ?? ""), client || null);
  revalidatePath("/");
}

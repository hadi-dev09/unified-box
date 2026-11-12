"use server";
import { revalidatePath } from "next/cache";
import { setThreadClient } from "@/lib/clients";
import { supabaseServer } from "@/lib/supabase/server";
import { markSeen } from "@/lib/threads";

async function uid() {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  return user?.id ?? null;
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

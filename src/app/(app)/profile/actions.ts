"use server";
import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { validatePassword } from "../../(auth)/auth-logic";

export type ProfileState = { ok?: string; error?: string } | undefined;

export async function updateName(_: ProfileState, f: FormData): Promise<ProfileState> {
  if (!(await currentUser())) return { error: "Please sign in again." };
  const name = String(f.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) return { error: "Enter your name." };
  const sb = await supabaseServer();
  const { error } = await sb.auth.updateUser({ data: { full_name: name } });
  if (error) return { error: "Couldn't save. Try again." };
  await sb.auth.refreshSession().catch(() => null);
  try { revalidatePath("/", "layout"); } catch { /* outside a request (tests) */ }
  return { ok: "Name saved." };
}

export async function changePassword(_: ProfileState, f: FormData): Promise<ProfileState> {
  if (!(await currentUser())) return { error: "Please sign in again." };
  const pw = String(f.get("password") ?? ""), confirm = String(f.get("confirm") ?? "");
  const bad = validatePassword(pw);
  if (bad) return { error: bad };
  if (pw !== confirm) return { error: "Passwords don't match." };
  const { error } = await (await supabaseServer()).auth.updateUser({ password: pw });
  if (error) return { error: /same|different/i.test(error.message) ? "Choose a password you haven't used here before." : /reauth|recent/i.test(error.message) ? "For security, sign out and sign in again, then change it." : "Couldn't change the password." };
  return { ok: "Password changed. Use it next time you sign in." };
}

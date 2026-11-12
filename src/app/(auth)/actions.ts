"use server";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { safeNext } from "@/lib/safe-next";
import { supabaseServer } from "@/lib/supabase/server";
import { friendlyAuthError, validatePassword, validEmail } from "./auth-logic";

export type FormState = { error?: string; ok?: string } | undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const callback = (next: string) => `${env("APP_URL")}/auth/callback?next=${encodeURIComponent(next)}`;

export async function signInWithPassword(_: FormState, f: FormData): Promise<FormState> {
  const email = str(f, "email").toLowerCase(), password = String(f.get("password") ?? ""), next = safeNext(str(f, "next"));
  if (!validEmail(email) || !password) return { error: "Enter your email and password." };
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (/not confirmed/i.test(error.message)) redirect(`/verify?type=signup&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
    return { error: friendlyAuthError(error.message) };
  }
  redirect(next);
}

export async function signUp(_: FormState, f: FormData): Promise<FormState> {
  const name = str(f, "name").slice(0, 80), email = str(f, "email").toLowerCase(), password = String(f.get("password") ?? "");
  const confirm = String(f.get("confirm") ?? ""), next = safeNext(str(f, "next"));
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  const weak = validatePassword(password);
  if (weak) return { error: weak };
  if (password !== confirm) return { error: "Passwords don't match." };
  if (f.get("terms") !== "on") return { error: "Please accept the terms to continue." };
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: callback(next), data: { full_name: name } } });
  if (error) return { error: friendlyAuthError(error.message) };
  if (data.session) redirect(next); // email confirmation disabled in Supabase
  redirect(`/verify?type=signup&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
}

export async function sendLoginCode(_: FormState, f: FormData): Promise<FormState> {
  const email = str(f, "email").toLowerCase(), next = safeNext(str(f, "next"));
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: callback(next) } });
  // Don't reveal whether the account exists: unknown emails get the same next screen.
  if (error && !/signups not allowed|not found|user not found/i.test(error.message)) return { error: friendlyAuthError(error.message) };
  redirect(`/verify?type=email&email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
}

export async function verifyCode(_: FormState, f: FormData): Promise<FormState> {
  const email = str(f, "email").toLowerCase(), token = str(f, "code").replace(/\s+/g, ""), next = safeNext(str(f, "next"));
  const type = (["signup", "email", "recovery"].includes(str(f, "type")) ? str(f, "type") : "email") as "signup" | "email" | "recovery";
  if (!validEmail(email)) return { error: "Missing email address. Start again." };
  if (!/^\d{6,10}$/.test(token)) return { error: "Enter the code from the email." };
  const sb = await supabaseServer();
  const { error } = await sb.auth.verifyOtp({ email, token, type });
  if (error) return { error: friendlyAuthError(error.message) };
  redirect(type === "recovery" ? "/reset-password" : next);
}

export async function resendCode(_: FormState, f: FormData): Promise<FormState> {
  const email = str(f, "email").toLowerCase(), type = str(f, "type"), next = safeNext(str(f, "next"));
  if (!validEmail(email)) return { error: "Missing email address. Start again." };
  const sb = await supabaseServer();
  const { error } = type === "signup"
    ? await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: callback(next) } })
    : type === "recovery"
      ? await sb.auth.resetPasswordForEmail(email, { redirectTo: callback("/reset-password") })
      : await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: callback(next) } });
  // Same answer whether or not the account exists (no account enumeration); only surface rate limits.
  if (error && /rate limit|too many|security purposes/i.test(error.message)) return { error: friendlyAuthError(error.message) };
  return { ok: "A new code is on its way. Check your inbox (and spam)." };
}

export async function forgotPassword(_: FormState, f: FormData): Promise<FormState> {
  const email = str(f, "email").toLowerCase();
  if (!validEmail(email)) return { error: "Enter a valid email address." };
  const sb = await supabaseServer();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: callback("/reset-password") });
  if (error && /rate limit|too many|security purposes/i.test(error.message)) return { error: friendlyAuthError(error.message) };
  redirect(`/verify?type=recovery&email=${encodeURIComponent(email)}`);
}

export async function updatePassword(_: FormState, f: FormData): Promise<FormState> {
  const password = String(f.get("password") ?? ""), confirm = String(f.get("confirm") ?? "");
  const weak = validatePassword(password);
  if (weak) return { error: weak };
  if (password !== confirm) return { error: "Passwords don't match." };
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "Your reset link has expired. Request a new one." };
  const { error } = await sb.auth.updateUser({ password });
  if (error) return { error: friendlyAuthError(error.message) };
  redirect("/?notice=password-updated");
}

export async function socialSignIn(f: FormData) {
  const provider = str(f, "provider") === "slack" ? "slack_oidc" : "google";
  const next = safeNext(str(f, "next"));
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: callback(next) } });
  if (error || !data.url) redirect(`/login?error=${encodeURIComponent("That sign-in option isn't available right now.")}`);
  redirect(data.url);
}

export async function signOut() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/");
}

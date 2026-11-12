// Pure helpers for the auth forms (no imports) so they can be unit-tested.

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return "Use at least 8 characters.";
  if (pw.length > 72) return "Use at most 72 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use at least one letter and one number.";
  return null;
}

export const validEmail = (e: string) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(e) && e.length <= 254;

/** Turns Supabase Auth errors into plain language (and never reveals whether an account exists). */
export function friendlyAuthError(message: string | undefined | null): string {
  const m = (message ?? "").toLowerCase();
  if (!m) return "Something went wrong. Please try again.";
  if (m.includes("invalid login credentials")) return "Wrong email or password.";
  if (m.includes("email not confirmed")) return "Please confirm your email first. We can send you a new code.";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes")) return "Too many attempts. Please wait a minute and try again.";
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Sign in instead.";
  if (m.includes("expired") || (m.includes("invalid") && m.includes("otp")) || m.includes("token has expired")) return "That code is invalid or has expired. Request a new one.";
  if (m.includes("weak") || m.includes("password should")) return "That password is too weak. Try a longer one.";
  if (m.includes("same") && m.includes("password")) return "Choose a password different from your current one.";
  if (m.includes("signups not allowed") || m.includes("signup is disabled")) return "New sign-ups are currently closed.";
  return "Something went wrong. Please try again.";
}

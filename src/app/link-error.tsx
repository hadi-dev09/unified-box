"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Supabase reports failed email links (expired, already used) in the URL fragment (#error=...), which servers
 * never see. Turn that into a visible message on the sign-in page instead of silently landing on the homepage.
 */
export function LinkErrorHandler() {
  const router = useRouter();
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    if (!h.get("error") && !h.get("error_description")) return;
    const code = h.get("error_code") ?? "";
    const msg = /expired|otp/i.test(code + (h.get("error_description") ?? ""))
      ? "That email link is invalid or has expired. Request a new one."
      : "That sign-in link didn't work. Please try again.";
    history.replaceState(null, "", window.location.pathname + window.location.search);
    router.replace(`/login?error=${encodeURIComponent(msg)}`);
  }, [router]);
  return null;
}

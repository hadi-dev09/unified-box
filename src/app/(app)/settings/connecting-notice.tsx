"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Shown right after a sign-in page sends you back: waits (up to ~40s) for the new channel to appear, then confirms. */
export function ConnectingNotice({ provider, count }: { provider: string; count: number }) {
  const router = useRouter();
  const start = useRef(count);
  const [tries, setTries] = useState(0);
  const done = count > start.current;
  useEffect(() => {
    if (done || tries >= 20) return;
    const t = setTimeout(() => { router.refresh(); setTries((n) => n + 1); }, 2000);
    return () => clearTimeout(t);
  }, [done, tries, router]);
  const name = provider === "whatsapp_web" ? "WhatsApp" : provider === "imap" ? "your email" : provider.charAt(0).toUpperCase() + provider.slice(1);
  return (
    <p role="status" className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${done ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-[var(--accent-soft)] text-[var(--accent-text)]"}`}>
      {done ? `${name} is connected. Your messages are arriving now.` : tries >= 20 ? `Still finishing ${name}. It will show up below in a moment.` : `Finishing connecting ${name}…`}
    </p>
  );
}

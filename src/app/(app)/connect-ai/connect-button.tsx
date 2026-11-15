"use client";
import { useState } from "react";

/** Copies the server URL (so it's ready to paste) and opens the assistant's connector page in a new tab. */
export function ConnectButton({ href, copyText, label, primary = false }: { href: string; copyText?: string; label: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={async () => {
        if (!copyText) return;
        try { await navigator.clipboard.writeText(copyText); setCopied(true); setTimeout(() => setCopied(false), 4000); } catch { /* clipboard blocked: user can use Copy */ }
      }}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${primary ? "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200" : "border border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"}`}
    >
      {copied ? "URL copied, paste it there ✓" : label}
    </a>
  );
}

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
      className={`${primary ? "btn-primary" : "btn"} w-full !py-2.5`}
    >
      {copied ? "URL copied, paste it there ✓" : label}
    </a>
  );
}

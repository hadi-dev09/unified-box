"use client";
import { useEffect, useState } from "react";

/** Renders a timestamp in the viewer's own timezone (the server runs in UTC). */
export function LocalTime({ iso, mode = "short" }: { iso: string; mode?: "short" | "full" }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const d = new Date(iso);
    const now = new Date();
    if (mode === "full") return setText(d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));
    const sameDay = d.toDateString() === now.toDateString();
    const sameYear = d.getFullYear() === now.getFullYear();
    setText(sameDay ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }));
  }, [iso, mode]);
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}

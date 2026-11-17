"use client";
import { useEffect, useState } from "react";

/** Renders a timestamp in the viewer's own timezone: "01:02 PM" today, "Nov 14" this year, else "Nov 14, 2025". */
export function LocalTime({ iso, mode = "short" }: { iso: string; mode?: "short" | "full" }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return setText("");
    const now = new Date();
    const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    if (mode === "full") return setText(`${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })}, ${time}`);
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (sameDay) return setText(time);
    if (d.toDateString() === yest.toDateString()) return setText("Yesterday");
    setText(d.toLocaleDateString("en-US", d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }));
  }, [iso, mode]);
  return <time dateTime={iso} suppressHydrationWarning title={iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toLocaleString("en-US") : undefined}>{text}</time>;
}

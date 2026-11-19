"use client";
import { useEffect, useState } from "react";

/** Renders a timestamp in the viewer's own timezone: "01:02 PM" today, "Nov 14" this year, else "Nov 14, 2025". */
export function LocalTime({ iso, mode = "short" }: { iso: string; mode?: "short" | "full" | "day" | "relative" }) {
  const [text, setText] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (mode === "full" || mode === "day") return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [mode]);
  useEffect(() => {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return setText("");
    const now = new Date();
    const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    if (mode === "relative") {
      const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
      const t = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
      const y = new Date(now); y.setDate(now.getDate() - 1);
      return setText(mins < 1 ? "Just now" : mins < 60 ? `${mins} min ago` : d.toDateString() === now.toDateString() ? t : d.toDateString() === y.toDateString() ? `Yesterday ${t}` : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${t}`);
    }
    if (mode === "day") {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      return setText(d.toDateString() === now.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }));
    }
    if (mode === "full") return setText(`${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })}, ${time}`);
    const ago = Math.floor((now.getTime() - d.getTime()) / 60_000);
    if (ago >= 0 && ago < 60) return setText(ago < 1 ? "Just now" : `${ago} min ago`);
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (sameDay) return setText(time);
    if (d.toDateString() === yest.toDateString()) return setText("Yesterday");
    setText(d.toLocaleDateString("en-US", d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }));
  }, [iso, mode, tick]);
  return <time dateTime={iso} suppressHydrationWarning title={iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso).toLocaleString("en-US") : undefined}>{text}</time>;
}

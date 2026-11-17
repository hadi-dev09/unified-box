"use client";
import { useEffect, useState } from "react";
import { setThemeAction } from "./actions";
import { Icon } from "./ui";

type Theme = "light" | "dark" | "system";
const read = (): Theme => ((document.cookie.match(/(?:^|; )ub_theme=([^;]+)/) ?? [])[1] as Theme) || "system";

/** Light / Dark / System toggle. Applies instantly and is remembered. */
export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => setTheme(read()), []);
  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && m.matches));
    apply();
    if (theme !== "system") return;
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [theme]);
  const pick = (t: Theme) => { setTheme(t); document.cookie = `ub_theme=${t}; path=/; max-age=31536000; samesite=lax`; setThemeAction(t).catch(() => {}); };
  const opt = (t: Theme, icon: "sun" | "moon" | "monitor", label: string) => (
    <button type="button" onClick={() => pick(t)} aria-pressed={theme === t} title={label} aria-label={`${label} theme`}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${theme === t ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "muted hover:text-[var(--text)]"}`}>
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  );
  return (
    <div role="group" aria-label="Theme" className="inline-flex items-center gap-0.5 rounded-lg bg-[var(--surface-2)] p-0.5">
      {opt("light", "sun", "Light")}{opt("dark", "moon", "Dark")}{opt("system", "monitor", "System")}
    </div>
  );
}

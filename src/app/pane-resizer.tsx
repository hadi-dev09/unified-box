"use client";
import { useEffect, useRef } from "react";

const KEY = "ub_list_width";
const MIN = 300, MAX = 760;

/**
 * Drag handle between the conversation list and the open conversation. Width is remembered on this device.
 * Arrow keys also resize it (accessible).
 */
export function PaneResizer({ targetId }: { targetId: string }) {
  const dragging = useRef(false);
  const apply = (w: number) => {
    const el = document.getElementById(targetId);
    const clamped = Math.max(MIN, Math.min(MAX, Math.round(w)));
    if (el) el.style.width = `${clamped}px`;
    return clamped;
  };
  useEffect(() => {
    let saved = 0;
    try { saved = Number(localStorage.getItem(KEY) ?? 0); } catch { /* ignore */ }
    if (saved) apply(saved);
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const el = document.getElementById(targetId);
      if (!el) return;
      const w = apply(e.clientX - el.getBoundingClientRect().left);
      try { localStorage.setItem(KEY, String(w)); } catch { /* ignore */ }
    };
    const up = () => { dragging.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize conversation list" tabIndex={0} title="Drag to resize"
      onPointerDown={(e) => { e.preventDefault(); dragging.current = true; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; }}
      onDoubleClick={() => { apply(420); try { localStorage.removeItem(KEY); } catch { /* ignore */ } }}
      onKeyDown={(e) => {
        const el = document.getElementById(targetId);
        if (!el || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
        const w = apply(el.getBoundingClientRect().width + (e.key === "ArrowRight" ? 24 : -24));
        try { localStorage.setItem(KEY, String(w)); } catch { /* ignore */ }
      }}
      className="group relative hidden w-2 shrink-0 cursor-col-resize lg:block">
      <span className="absolute inset-y-6 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-[var(--border)] transition group-hover:bg-[var(--accent)] group-focus-visible:bg-[var(--accent)]" />
    </div>
  );
}

"use client";
import { useEffect, useRef } from "react";
import { markSeenAction } from "./actions";

/**
 * Marks the conversation read when you open it, once. If you then press "Mark unread" while it's open, it stays
 * unread (it is only marked read again when you open it next time).
 */
export function MarkSeen({ threadId, unread }: { threadId: string; unread: boolean }) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (done.current === threadId) return;
    done.current = threadId;
    if (unread) markSeenAction(threadId).catch(() => {});
  }, [threadId, unread]);
  return null;
}

"use client";
import { useEffect } from "react";
import { markSeenAction } from "./actions";

/** Marks the open conversation as read (once per open). */
export function MarkSeen({ threadId, unread }: { threadId: string; unread: boolean }) {
  useEffect(() => {
    if (unread) markSeenAction(threadId).catch(() => {});
  }, [threadId, unread]);
  return null;
}

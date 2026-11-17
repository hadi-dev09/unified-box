import { applyThreadAction } from "./thread-actions";

/** Marks a conversation read (in Gmail too when the account allows it). */
export async function markSeen(userId: string, threadId: string) {
  await applyThreadAction(userId, [threadId], "read");
}

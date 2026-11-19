"use client";
import Link from "next/link";
import { LocalTime } from "./local-time";
import { MessageBody } from "./message-body";
import { Avatar, Icon } from "./ui";

export type ChatMsg = { id: string; external_id?: string | null; thread_ts?: string | null; from_name: string | null; from_addr: string | null; sent_at: string; is_outgoing: boolean; body_text: string | null };

/** Slack threads that have their own conversation, keyed by the parent message's ts. */
export type ThreadLinks = Record<string, { href: string; count: number; unread: boolean; last: string }>;

const tsOf = (m: ChatMsg) => (m.external_id ?? "").split(":").pop() ?? "";

/**
 * Chat conversations. Slack looks like Slack (name + time header, grouped messages, thread replies, "Reply in thread");
 * WhatsApp/Telegram look like a phone chat (bubbles).
 */
export function ChatTimeline({ messages, provider, canReply, threadView = false, threadLinks = {}, parentHref = null }: {
  messages: ChatMsg[]; provider: string; canReply: boolean; threadView?: boolean; threadLinks?: ThreadLinks; parentHref?: string | null;
}) {
  const byTs = new Map(messages.map((m) => [tsOf(m), m]));
  const replyInThread = (m: ChatMsg) => {
    const root = m.thread_ts || tsOf(m);
    window.dispatchEvent(new CustomEvent("ub:reply-thread", { detail: { ts: root, preview: (byTs.get(root)?.body_text ?? m.body_text ?? "").replace(/\s+/g, " ").slice(0, 80) } }));
  };
  const day = (m: ChatMsg, prev?: ChatMsg) => !prev || new Date(prev.sent_at).toDateString() !== new Date(m.sent_at).toDateString();
  const Divider = ({ iso }: { iso: string }) => (
    <div className="relative my-4 flex items-center justify-center">
      <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--border)]" />
      <span className="relative rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-0.5 text-[11px] font-semibold"><LocalTime iso={iso} mode="day" /></span>
    </div>
  );

  if (provider !== "slack") {
    return (
      <div className="space-y-2">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = prev && !day(m, prev) && prev.is_outgoing === m.is_outgoing && (prev.from_name ?? prev.from_addr) === (m.from_name ?? m.from_addr) && new Date(m.sent_at).getTime() - new Date(prev.sent_at).getTime() < 5 * 60_000;
          return (
            <div key={m.id}>
              {day(m, prev) && <Divider iso={m.sent_at} />}
              <div className={`flex items-end gap-2 ${m.is_outgoing ? "flex-row-reverse" : ""} ${grouped ? "-mt-1" : ""}`}>
                <span className={grouped ? "invisible" : ""}><Avatar name={m.from_name || m.from_addr || "?"} you={m.is_outgoing} size="sm" /></span>
                <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${m.is_outgoing ? "rounded-br-md bg-[var(--accent)] text-white" : "rounded-bl-md bg-[var(--surface-2)]"}`}>
                  {!grouped && !m.is_outgoing && <p className="mb-0.5 text-xs font-semibold">{m.from_name || m.from_addr}</p>}
                  <div className={`text-sm leading-relaxed ${m.is_outgoing ? "[&_a]:text-white [&_a]:underline" : ""}`}>{m.body_text?.trim() ? <MessageBody text={m.body_text} /> : <span className="italic opacity-70">Attachment</span>}</div>
                  <p className={`mt-0.5 text-right text-[10px] ${m.is_outgoing ? "text-white/70" : "muted"}`}><LocalTime iso={m.sent_at} mode="relative" /></p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="-mx-2">
      {threadView && (
        <p className="mb-2 flex items-center gap-2 px-2 text-xs muted">
          <Icon name="reply" className="h-3.5 w-3.5" /> Thread
          {parentHref && <> · <Link href={parentHref} className="font-medium text-[var(--accent-text)] hover:underline">Open the conversation</Link></>}
        </p>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const name = m.is_outgoing ? "You" : m.from_name || m.from_addr || "Unknown";
        const grouped = prev && !day(m, prev) && (prev.from_name ?? prev.from_addr) === (m.from_name ?? m.from_addr) && prev.is_outgoing === m.is_outgoing
          && (prev.thread_ts ?? null) === (m.thread_ts ?? null) && new Date(m.sent_at).getTime() - new Date(prev.sent_at).getTime() < 5 * 60_000;
        const parent = m.thread_ts ? byTs.get(m.thread_ts) : undefined;
        return (
          <div key={m.id}>
            {threadView && i === 1 && (
              <div className="relative my-3 flex items-center gap-3 px-2 text-xs muted">
                <span>{messages.length - 1} {messages.length === 2 ? "reply" : "replies"}</span><span className="h-px flex-1 bg-[var(--border)]" />
              </div>
            )}
            {day(m, prev) && !(threadView && i === 1) && <Divider iso={m.sent_at} />}
            <div className={`group/msg relative flex gap-3 rounded-lg px-2 ${grouped ? "py-0.5" : "pb-0.5 pt-2"} hover:bg-[var(--surface-2)]`}>
              <div className="w-9 shrink-0">
                {grouped
                  ? <span className="invisible block pt-1 text-right text-[10px] muted group-hover/msg:visible"><LocalTime iso={m.sent_at} /></span>
                  : <Avatar name={m.from_name || m.from_addr || "?"} you={m.is_outgoing} />}
              </div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <p className="flex items-baseline gap-2">
                    <span className="text-sm font-bold">{name}</span>
                    <span className="text-[11px] muted"><LocalTime iso={m.sent_at} mode="relative" /></span>
                  </p>
                )}
                {m.thread_ts && !threadView && (
                  <p className="mb-0.5 flex items-center gap-1.5 text-[11px] muted">
                    <Icon name="reply" className="h-3 w-3 shrink-0" />
                    <span className="truncate">Replied in thread{parent ? <>: <span className="italic">“{(parent.body_text ?? "").replace(/\s+/g, " ").slice(0, 70)}”</span></> : ""}</span>
                  </p>
                )}
                <div className="text-[15px] leading-relaxed">{m.body_text?.trim() ? <MessageBody text={m.body_text} /> : <span className="italic muted">Attachment</span>}</div>
                {!threadView && threadLinks[tsOf(m)] && (() => { const l = threadLinks[tsOf(m)]; return (
                  <Link href={l.href} className="mt-1 inline-flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1 text-xs hover:border-[var(--border)] hover:bg-[var(--surface)]">
                    <Icon name="reply" className="h-3.5 w-3.5 text-[var(--accent-text)]" />
                    <span className="font-semibold text-[var(--accent-text)]">{l.count} {l.count === 1 ? "reply" : "replies"}</span>
                    {l.unread && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" aria-label="unread" />}
                    <span className="muted">Last reply <LocalTime iso={l.last} mode="relative" /></span>
                  </Link>
                ); })()}
              </div>
              {canReply && !threadView && threadLinks[m.thread_ts || tsOf(m)] ? (
                <Link href={threadLinks[m.thread_ts || tsOf(m)].href} title="Open thread" aria-label={`Open thread with ${name}`}
                  className="absolute right-2 top-1 hidden items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-medium shadow-[var(--shadow)] group-hover/msg:inline-flex group-focus-within/msg:inline-flex">
                  <Icon name="reply" className="h-3.5 w-3.5" /> Reply in thread
                </Link>
              ) : canReply && !threadView && (
                <button onClick={() => replyInThread(m)} title="Reply in thread" aria-label={`Reply in thread to ${name}`}
                  className="absolute right-2 top-1 hidden items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-medium shadow-[var(--shadow)] group-hover/msg:inline-flex group-focus-within/msg:inline-flex">
                  <Icon name="reply" className="h-3.5 w-3.5" /> Reply in thread
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { linkify } from "@/lib/linkify";

/** Renders message text with short, safe, tappable links (http/https only). React escapes all text. */
export function MessageBody({ text }: { text: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
      {linkify(text).map((s, i) =>
        "href" in s ? (
          <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow" title={s.href} className="text-blue-600 underline decoration-blue-600/30 hover:decoration-blue-600 dark:text-blue-400">{s.label}</a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </pre>
  );
}

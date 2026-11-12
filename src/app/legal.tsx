import Link from "next/link";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  const contact = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-[15px] leading-relaxed text-neutral-800 dark:text-neutral-200">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">← Unified Box</Link>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-neutral-500">Last updated {updated}</p>
      <div className="mt-8 space-y-5 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">{children}</div>
      {contact && <p className="mt-10 text-sm text-neutral-500">Questions: <a className="underline" href={`mailto:${contact}`}>{contact}</a></p>}
    </main>
  );
}

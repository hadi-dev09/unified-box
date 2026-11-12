import { socialSignIn } from "./actions";

const GoogleG = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
    <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
  </svg>
);

/** Social sign-in buttons, shown only for providers that are switched on in Supabase. */
export function SocialButtons({ next, google, slack }: { next: string; google: boolean; slack: boolean }) {
  if (!google && !slack) return null;
  const btn = "inline-flex w-full items-center justify-center gap-2.5 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-[15px] font-medium transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-950 dark:hover:bg-neutral-800";
  return (
    <div className="space-y-2.5">
      {google && (
        <form action={socialSignIn}><input type="hidden" name="provider" value="google" /><input type="hidden" name="next" value={next} />
          <button className={btn}><GoogleG /> Continue with Google</button>
        </form>
      )}
      {slack && (
        <form action={socialSignIn}><input type="hidden" name="provider" value="slack" /><input type="hidden" name="next" value={next} />
          <button className={btn}><span className="text-lg leading-none">#</span> Continue with Slack</button>
        </form>
      )}
      <div className="flex items-center gap-3 py-1 text-xs text-neutral-400"><span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />or<span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" /></div>
    </div>
  );
}

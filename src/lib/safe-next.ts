/** Only allow same-site relative paths as post-login destinations (blocks open redirects). */
export function safeNext(v: string | null | undefined): string {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/";
  return v;
}

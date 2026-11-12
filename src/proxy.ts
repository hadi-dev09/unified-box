import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Keeps the Supabase session alive: refreshes the access token (1h) using the refresh token and writes the
 * updated cookies, so people stay signed in instead of needing a new email link every hour.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || process.env.DEMO_MODE === "1" || process.env.UNIFIED_BOX_TEST === "1") return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // Do not remove: this call performs the refresh.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Skip static assets and the token-authenticated API surface (MCP, OAuth, discovery, cron).
  matcher: ["/((?!_next/static|_next/image|favicon|icon|apple-touch-icon|manifest|api/mcp|api/oauth|\\.well-known|.*\\.(?:png|svg|ico|webmanifest)$).*)"],
};

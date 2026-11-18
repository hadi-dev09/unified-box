import type { NextConfig } from "next";

const config: NextConfig = {
  // Telegram's MTProto client uses Node sockets and dynamic requires; keep it out of the bundle.
  serverExternalPackages: ["telegram"],
  // Keep recently visited inbox pages for 30s on the client, so going back and forth is instant.
  experimental: { staleTimes: { dynamic: 30, static: 180 } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The OAuth consent screen must never be framed (clickjacking the Approve button).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
export default config;

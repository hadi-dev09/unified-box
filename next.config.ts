import type { NextConfig } from "next";

const config: NextConfig = {
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

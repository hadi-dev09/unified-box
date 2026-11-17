import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { LinkErrorHandler } from "./link-error";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Unified Box",
  description: "All your client conversations in one place.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Unified Box", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f6f8" }, { media: "(prefers-color-scheme: dark)", color: "#0b0d12" }] };

// Applies the saved theme before first paint (no flash). "system" follows the device and updates live.
const THEME_SCRIPT = `(function(){try{var t=(document.cookie.match(/(?:^|; )ub_theme=([^;]+)/)||[])[1]||"system";var m=window.matchMedia("(prefers-color-scheme: dark)");var a=function(){document.documentElement.classList.toggle("dark",t==="dark"||(t==="system"&&m.matches));};a();if(t==="system")m.addEventListener("change",a);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("ub_theme")?.value;
  return (
    <html lang="en" className={`${inter.variable} ${theme === "dark" ? "dark" : ""}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="font-sans antialiased"><LinkErrorHandler />{children}</body>
    </html>
  );
}

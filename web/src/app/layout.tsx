import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MTB Inbox", template: "%s · MTB Inbox" },
  description: "WhatsApp customer platform for Muslimtravelbug",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "MTB Inbox", statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = { themeColor: "#0B2B26", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

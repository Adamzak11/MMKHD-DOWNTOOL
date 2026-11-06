import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "MAMATKILAT VIDEO TOOLS",
  description: "Compress videos intelligently. Preserve quality. Download and process videos in one place.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#090909", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

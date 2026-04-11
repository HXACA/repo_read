import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ClientLayout } from "./client-layout";

const display = localFont({
  src: "../../public/fonts/CrimsonPro-Variable.woff2",
  variable: "--font-display",
  display: "swap",
});

const body = localFont({
  src: "../../public/fonts/Outfit-Variable.woff2",
  variable: "--font-body",
  display: "swap",
});

const mono = localFont({
  src: "../../public/fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RepoRead",
  description: "Local-first code reading & technical writing workbench",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body style={{ fontFamily: "var(--font-body), system-ui, sans-serif" }}>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}

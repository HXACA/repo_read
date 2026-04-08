import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "RepoRead",
  description: "Local-first code reading & technical writing workbench",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        <header className="border-b border-gray-200 dark:border-gray-800">
          <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
            <Link href="/" className="text-lg font-bold">
              RepoRead
            </Link>
            <Link
              href="/settings/providers"
              className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Settings
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}

"use client";

import Link from "next/link";
import { SettingsProvider, useSettings } from "@/lib/settings-context";
import { SettingsPanel } from "@/lib/settings-panel";
import { t } from "@/lib/i18n";

function Header() {
  const { locale, togglePanel } = useSettings();

  return (
    <header
      style={{
        borderBottom: "1px solid var(--rr-border)",
        background: "var(--rr-bg-elevated)",
      }}
    >
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" className="group flex items-center gap-2.5">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white"
            style={{ background: "var(--rr-accent)" }}
          >
            R
          </span>
          <span
            className="text-base font-semibold tracking-tight"
            style={{
              fontFamily: "var(--font-display), Georgia, serif",
              color: "var(--rr-text)",
            }}
          >
            {t(locale, "brand")}
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-sm font-medium"
            style={{ color: "var(--rr-text-secondary)" }}
          >
            {t(locale, "projects")}
          </Link>
          <button
            onClick={togglePanel}
            className="flex items-center gap-1.5 text-sm font-medium"
            style={{ color: "var(--rr-text-secondary)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {t(locale, "settings")}
          </button>
        </div>
      </nav>
    </header>
  );
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <Header />
      {children}
      <SettingsPanel />
    </SettingsProvider>
  );
}

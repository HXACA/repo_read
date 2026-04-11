"use client";

import { useSettings, type FontSize } from "./settings-context";
import { t, LOCALES, type Locale } from "./i18n";

export function SettingsPanel() {
  const {
    theme,
    fontSize,
    locale,
    setTheme,
    setFontSize,
    setLocale,
    panelOpen,
    togglePanel,
  } = useSettings();

  if (!panelOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={togglePanel}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col overflow-y-auto"
        style={{
          background: "var(--rr-bg-elevated)",
          borderLeft: "1px solid var(--rr-border)",
          boxShadow: "var(--rr-shadow-lg)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--rr-border)" }}
        >
          <h2
            className="text-base font-semibold"
            style={{
              fontFamily: "var(--font-display), Georgia, serif",
              color: "var(--rr-text)",
            }}
          >
            {t(locale, "settingsTitle")}
          </h2>
          <button
            onClick={togglePanel}
            className="flex h-7 w-7 items-center justify-center rounded text-lg"
            style={{ color: "var(--rr-text-muted)" }}
          >
            &times;
          </button>
        </div>

        <div className="flex-1 space-y-6 px-5 py-5">
          {/* Language */}
          <SettingGroup label={t(locale, "language")}>
            <div className="flex gap-2">
              {LOCALES.map((l) => (
                <ToggleButton
                  key={l.code}
                  active={locale === l.code}
                  onClick={() => setLocale(l.code as Locale)}
                >
                  {l.label}
                </ToggleButton>
              ))}
            </div>
          </SettingGroup>

          {/* Theme */}
          <SettingGroup label={t(locale, "darkMode")}>
            <div className="flex gap-2">
              <ToggleButton
                active={theme === "light"}
                onClick={() => setTheme("light")}
              >
                {locale === "zh" ? "浅色" : "Light"}
              </ToggleButton>
              <ToggleButton
                active={theme === "dark"}
                onClick={() => setTheme("dark")}
              >
                {locale === "zh" ? "深色" : "Dark"}
              </ToggleButton>
            </div>
          </SettingGroup>

          {/* Font Size */}
          <SettingGroup label={t(locale, "fontSize")}>
            <div className="flex gap-2">
              {(["sm", "base", "lg"] as FontSize[]).map((f) => (
                <ToggleButton
                  key={f}
                  active={fontSize === f}
                  onClick={() => setFontSize(f)}
                >
                  {f === "sm"
                    ? t(locale, "fontSmall")
                    : f === "base"
                      ? t(locale, "fontBase")
                      : t(locale, "fontLarge")}
                </ToggleButton>
              ))}
            </div>
          </SettingGroup>
        </div>
      </div>
    </>
  );
}

function SettingGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        className="mb-2 block text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--rr-text-muted)" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
      style={
        active
          ? {
              background: "var(--rr-accent)",
              color: "#fff",
            }
          : {
              background: "var(--rr-bg-surface)",
              color: "var(--rr-text-secondary)",
              border: "1px solid var(--rr-border)",
            }
      }
    >
      {children}
    </button>
  );
}

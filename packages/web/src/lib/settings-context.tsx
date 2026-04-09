"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Locale } from "./i18n";

export type FontSize = "sm" | "base" | "lg";
export type Theme = "light" | "dark";

export type Settings = {
  theme: Theme;
  fontSize: FontSize;
  locale: Locale;
  apiKey: string;
};

type SettingsContextValue = Settings & {
  setTheme: (t: Theme) => void;
  setFontSize: (f: FontSize) => void;
  setLocale: (l: Locale) => void;
  setApiKey: (k: string) => void;
  panelOpen: boolean;
  togglePanel: () => void;
};

const defaults: Settings = {
  theme: "light",
  fontSize: "base",
  locale: "zh",
  apiKey: "",
};

const LS_KEY = "reporead-settings";

function load(): Settings {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    // Silently ignore storage errors
  }
}

const SettingsContext = createContext<SettingsContextValue>({
  ...defaults,
  setTheme: () => {},
  setFontSize: () => {},
  setLocale: () => {},
  setApiKey: () => {},
  panelOpen: false,
  togglePanel: () => {},
});

const FONT_SIZES: Record<FontSize, string> = {
  sm: "15px",
  base: "17px",
  lg: "19px",
};

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    setSettings(load());
    setMounted(true);
  }, []);

  // Apply theme and font size to DOM
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;

    if (settings.theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    root.style.setProperty("--rr-font-size", FONT_SIZES[settings.fontSize]);
  }, [settings.theme, settings.fontSize, mounted]);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        save(next);
        return next;
      });
    },
    [],
  );

  const ctx: SettingsContextValue = {
    ...settings,
    setTheme: (t) => update({ theme: t }),
    setFontSize: (f) => update({ fontSize: f }),
    setLocale: (l) => update({ locale: l }),
    setApiKey: (k) => update({ apiKey: k }),
    panelOpen,
    togglePanel: () => setPanelOpen((p) => !p),
  };

  return (
    <SettingsContext.Provider value={ctx}>{children}</SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}

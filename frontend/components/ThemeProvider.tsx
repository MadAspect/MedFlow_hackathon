"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { DARK_QUERY, THEME_STORAGE_KEY, normalizePreference, resolveTheme, type ResolvedTheme, type ThemePreference } from "@/lib/theme";

const CHANGE_EVENT = "waitless-theme-change";

function readPreference(): ThemePreference {
  try {
    return normalizePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system"; // storage blocked: still works for this page view
  }
}

function subscribePreference(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === THEME_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage); // another tab changed it
  window.addEventListener(CHANGE_EVENT, onChange); // this tab changed it
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readSystemDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

function subscribeSystem(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribePreference, readPreference, () => "system" as ThemePreference);
  const systemDark = useSyncExternalStore(subscribeSystem, readSystemDark, () => false);
  const resolved = resolveTheme(preference, systemDark);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  const setPreference = useCallback((p: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {
      /* storage blocked: the change still applies until reload */
    }
    // "storage" only fires in other tabs, so notify this one ourselves.
    window.dispatchEvent(new Event(CHANGE_EVENT));
    document.documentElement.setAttribute("data-theme", resolveTheme(p, readSystemDark()));
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>.");
  return ctx;
}

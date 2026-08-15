import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { themeOptions, THEME_PREFERENCE_CHANGED_EVENT, THEME_STORAGE_KEY } from "../app/constants";
import { getSystemTheme, isThemePreference, readStoredThemePreference, resolveTheme } from "../app/storage";
import type { ResolvedTheme, ThemePreference } from "../app/types";

export function useThemePreference() {
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(readStoredThemePreference);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  const resolvedTheme = resolveTheme(themePreference, systemTheme);
  const activeThemeIndex = Math.max(
    0,
    themeOptions.findIndex((option) => option.key === themePreference),
  );
  const selectedThemeOption = themeOptions[activeThemeIndex];
  const resolvedThemeLabel = themeOptions.find((option) => option.key === resolvedTheme)?.label ?? selectedThemeOption.label;

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemTheme(mediaQuery.matches ? "dark" : "light");

    updateSystemTheme();
    mediaQuery.addEventListener("change", updateSystemTheme);
    return () => mediaQuery.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const syncStoredTheme = () => setThemePreferenceState(readStoredThemePreference());
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isThemePreference(event.newValue)) {
        setThemePreferenceState(event.newValue);
      }
    };

    window.addEventListener("focus", syncStoredTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", syncStoredTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ThemePreference>(THEME_PREFERENCE_CHANGED_EVENT, (event) => {
      if (isThemePreference(event.payload)) setThemePreferenceState(event.payload);
    })
      .then((disposeListener) => {
        if (disposed) disposeListener();
        else unlisten = disposeListener;
      })
      .catch((error: unknown) => console.warn("Failed to listen for theme changes", error));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const setThemePreference = useCallback((nextTheme: ThemePreference) => {
    setThemePreferenceState(nextTheme);
    if (isTauri()) {
      void emit(THEME_PREFERENCE_CHANGED_EVENT, nextTheme).catch((error: unknown) =>
        console.warn("Failed to sync theme across windows", error),
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    }
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = themePreference;
    document.documentElement.style.colorScheme = resolvedTheme === "dark" ? "dark" : "light";
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    if (!isTauri()) return;

    const nativeTheme = themePreference === "system" ? null : resolvedTheme === "dark" ? "dark" : "light";
    void getCurrentWindow()
      .setTheme(nativeTheme)
      .catch((error: unknown) => console.warn("Failed to sync the native window theme", error));
  }, [resolvedTheme, themePreference]);

  return {
    activeThemeIndex,
    resolvedTheme,
    resolvedThemeLabel,
    setThemePreference,
    themePreference,
  };
}

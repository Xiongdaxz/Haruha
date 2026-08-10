import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { themeOptions, THEME_STORAGE_KEY } from "../app/constants";
import { getSystemTheme, readStoredThemePreference, resolveTheme } from "../app/storage";
import type { ResolvedTheme, ThemePreference } from "../app/types";

export function useThemePreference() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(readStoredThemePreference);
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

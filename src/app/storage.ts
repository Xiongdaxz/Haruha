import { defaultSpeedTestConfig } from "../lib/api";
import type { SpeedTestConfig, SpeedTestHistoryEntry } from "../lib/types";
import {
  SPEED_TEST_HISTORY_STORAGE_KEY,
  SPEED_TEST_STORAGE_KEY,
  SPLIT_LIMITS,
  SPLIT_STORAGE_KEYS,
  THEME_STORAGE_KEY,
  themeOptions,
} from "./constants";
import type { ResizableNavKey, ResolvedTheme, ThemePreference } from "./types";

export function readStoredSplitWidth(view: ResizableNavKey) {
  if (typeof window === "undefined") return null;
  const rawValue = window.localStorage.getItem(SPLIT_STORAGE_KEYS[view]);
  const parsedValue = rawValue ? Number(rawValue) : Number.NaN;
  if (!Number.isFinite(parsedValue)) return null;
  return Math.max(SPLIT_LIMITS[view].minLeft, Math.round(parsedValue));
}

export function readStoredSpeedTestConfig(): SpeedTestConfig {
  if (typeof window === "undefined") return defaultSpeedTestConfig;
  const rawValue = window.localStorage.getItem(SPEED_TEST_STORAGE_KEY);
  if (!rawValue) return defaultSpeedTestConfig;
  try {
    const parsedValue = JSON.parse(rawValue) as Partial<SpeedTestConfig>;
    return {
      downloadUrl: typeof parsedValue.downloadUrl === "string" ? parsedValue.downloadUrl : defaultSpeedTestConfig.downloadUrl,
      downloadBytesLimit:
        typeof parsedValue.downloadBytesLimit === "number"
          ? parsedValue.downloadBytesLimit
          : defaultSpeedTestConfig.downloadBytesLimit,
    };
  } catch {
    return defaultSpeedTestConfig;
  }
}

export function readStoredSpeedTestHistory(): SpeedTestHistoryEntry[] {
  if (typeof window === "undefined") return [];
  const rawValue = window.localStorage.getItem(SPEED_TEST_HISTORY_STORAGE_KEY);
  if (!rawValue) return [];
  try {
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return [];
    return parsedValue
      .map((item): SpeedTestHistoryEntry | null => {
        if (!item || typeof item !== "object") return null;
        const value = item as Partial<SpeedTestHistoryEntry>;
        if (typeof value.id !== "string" || typeof value.createdAt !== "string" || typeof value.ok !== "boolean") {
          return null;
        }
        return {
          id: value.id,
          createdAt: value.createdAt,
          ok: value.ok,
          latencyMs: readOptionalNumber(value.latencyMs),
          downloadMbps: readOptionalNumber(value.downloadMbps),
          downloadedBytes: readOptionalNumber(value.downloadedBytes),
          durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : 0,
          message: typeof value.message === "string" ? value.message : "",
        };
      })
      .filter((item): item is SpeedTestHistoryEntry => item !== null)
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function readStoredThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "haruha";
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return themeOptions.some((option) => option.key === storedTheme) ? (storedTheme as ThemePreference) : "haruha";
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

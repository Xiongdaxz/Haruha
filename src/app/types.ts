import type { PacRule } from "../lib/types";

export type NavKey = "overview" | "config" | "pac" | "settings";
export type ResizableNavKey = Extract<NavKey, "config" | "pac">;
export type PacRuleTab = PacRule["strategy"];
export type SettingsKey = "appearance" | "unified-lists" | "config-directory";
export type ThemePreference = "system" | "light" | "dark" | "haruha" | "sunset";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

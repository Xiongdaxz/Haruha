export type NavKey = "overview" | "config" | "pac" | "settings";
export type ResizableNavKey = Extract<NavKey, "config" | "pac">;
export type PacRuleTab = "proxy" | "direct";
export type RuleListSortDirection = "asc" | "desc";
export type RuleListSortField = "domain" | "strategy" | "type" | "status";
export interface RuleListSortState {
  field: RuleListSortField;
  direction: RuleListSortDirection;
}
export type SettingsKey = "appearance" | "unified-lists" | "config-directory" | "about";
export type ThemePreference = "system" | "light" | "dark" | "haruha" | "sunset";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

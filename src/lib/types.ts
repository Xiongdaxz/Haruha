export type ProxyMode = "off" | "manual" | "pac";

export interface ProxyProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  bypassLocal: boolean;
  bypassList: string[];
  pacRules: PacRule[];
  removedBuiltinDirectDomains: string[];
  disabledBuiltinDirectDomains: string[];
  mode: ProxyMode;
}

export interface UnifiedLists {
  directEnabled: boolean;
  directDomains: string[];
  proxyEnabled: boolean;
  proxyDomains: string[];
}

export interface PacRule {
  id: string;
  domain: string;
  strategy: "proxy" | "direct";
  enabled: boolean;
  note?: string;
  readonly?: boolean;
  source?: "user" | "builtin";
}

export interface PlatformCapabilities {
  manualProxy: boolean;
  pacProxy: boolean;
  tray: boolean;
  globalShortcut: boolean;
  autoStart: boolean;
  requiresElevatedPermission: boolean;
  details: string[];
}

export interface ProxyState {
  mode: ProxyMode;
  address?: string;
  pacUrl?: string;
  platform: string;
  capabilities: PlatformCapabilities;
  lastError?: string;
}

export interface IpInfo {
  ip: string;
  location: string;
  latencyMs?: number | null;
  source: string;
}

export interface TestResult {
  ok: boolean;
  latencyMs?: number;
  message: string;
}

export type QuickSiteCategory = "ai" | "social" | "dev" | "tools" | "media";

export interface QuickSite {
  id: string;
  name: string;
  url: string;
  domain: string;
  category: QuickSiteCategory;
  faviconUrl: string;
}

export interface SpeedTestConfig {
  downloadUrl: string;
  downloadBytesLimit: number;
}

export interface SpeedTestResult {
  ok: boolean;
  latencyMs?: number;
  downloadMbps?: number;
  downloadedBytes?: number;
  durationMs: number;
  message: string;
}

export interface SpeedTestHistoryEntry extends SpeedTestResult {
  id: string;
  createdAt: string;
}

export interface NetworkTrafficSample {
  receivedBytes: number;
  sentBytes: number;
  timestampMs: number;
}

export interface NetworkTrafficPoint {
  timestampMs: number;
  downloadBytesPerSecond: number;
  uploadBytesPerSecond: number;
}

export type AppLogLevel = "INFO" | "DEBUG" | "WARN" | "ERROR";

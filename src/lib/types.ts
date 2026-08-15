export type ProxyMode = "off" | "manual" | "pac";

export interface ProxyProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  bypassLocal: boolean;
  mode: ProxyMode;
}

export interface UnifiedLists {
  directEnabled: boolean;
  directDomains: string[];
  disabledDirectDomains: string[];
  proxyEnabled: boolean;
  proxyDomains: string[];
  disabledProxyDomains: string[];
}

export type PacRuleStrategy = "proxy" | "direct";

export interface PacRule {
  id: string;
  domain: string;
  strategy: PacRuleStrategy;
  enabled: boolean;
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

export interface SavedConfiguration {
  profile: ProxyProfile;
  unifiedLists: UnifiedLists;
  proxyState: ProxyState;
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
  directDownloadUrl: string;
  downloadBytesLimit: number;
}

export type SpeedTestTarget = "proxy" | "direct";

export interface SpeedTestResult {
  ok: boolean;
  latencyMs?: number;
  downloadMbps?: number;
  downloadedBytes?: number;
  durationMs: number;
  message: string;
}

export interface SpeedTestProgress {
  target: SpeedTestTarget;
  latencyMs: number;
  downloadMbps: number;
  downloadedBytes: number;
  elapsedMs: number;
}

export interface SpeedTestHistoryEntry extends SpeedTestResult {
  id: string;
  createdAt: string;
  target: SpeedTestTarget;
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

export type TrafficMonitorStatus = "idle" | "starting" | "running" | "error";

export interface TrafficMonitorCapability {
  supported: boolean;
  requiresElevation: boolean;
  reason?: string;
}

export interface TrafficApplicationUsage {
  id: string;
  name: string;
  processCount: number;
  downloadBytes: number;
  uploadBytes: number;
  totalBytes: number;
}

export interface TrafficMonitorSnapshot {
  status: TrafficMonitorStatus;
  startedAtMs?: number;
  updatedAtMs: number;
  applications: TrafficApplicationUsage[];
  error?: string;
}

export type AppLogLevel = "INFO" | "DEBUG" | "WARN" | "ERROR";

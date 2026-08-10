import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppLogLevel,
  IpInfo,
  NetworkTrafficSample,
  PacRule,
  ProxyProfile,
  ProxyState,
  SpeedTestConfig,
  SpeedTestResult,
  TestResult,
  UnifiedLists,
} from "./types";

const isTauri = "__TAURI_INTERNALS__" in window;
let mockTrafficReceivedBytes = 8 * 1024 * 1024 * 1024;
let mockTrafficSentBytes = 2 * 1024 * 1024 * 1024;
let mockTrafficUpdatedAt = Date.now();

export const defaultRules: PacRule[] = [
  "googleapis.com",
  "google.com",
  "googleusercontent.com",
  "google-analytics.com",
  "googletagmanager.com",
  "ggpht.com",
  "googlecode.com",
  "chromium.org",
  "youtube.com",
  "youtu.be",
  "ytimg.com",
  "facebook.com",
  "fbcdn.net",
  "instagram.com",
  "threads.net",
  "whatsapp.com",
  "whatsapp.net",
  "twitter.com",
  "x.com",
  "twimg.com",
  "t.co",
  "github.com",
  "githubusercontent.com",
  "githubassets.com",
  "github.io",
  "npm.im",
  "telegram.org",
  "t.me",
  "telegram.me",
  "apple.com",
  "icloud.com",
  "mzstatic.com",
  "amazonaws.com",
  "amazon.com",
  "cloudfront.net",
  "cloudflare.com",
  "cdn.cloudflare.net",
  "1.1.1.1",
  "reddit.com",
  "redd.it",
  "redditmedia.com",
  "reddituploads.com",
  "imgur.com",
  "tumblr.com",
  "flickr.com",
  "pinterest.com",
  "snapchat.com",
  "tiktok.com",
  "discord.com",
  "discordapp.com",
  "discordapp.net",
  "twitch.tv",
  "twitchapps.com",
  "spotify.com",
  "scdn.co",
  "line.me",
  "line.naver.jp",
  "nytimes.com",
  "bbc.com",
  "bbc.co.uk",
  "reuters.com",
  "theguardian.com",
  "bloomberg.com",
  "wsj.com",
  "cnn.com",
  "nbcnews.com",
  "foxnews.com",
  "voachinese.com",
  "rfa.org",
  "stackoverflow.com",
  "stackexchange.com",
  "medium.com",
  "dev.to",
  "hashnode.com",
  "docker.com",
  "pypi.org",
  "pythonhosted.org",
  "rubygems.org",
  "gradle.org",
  "jetbrains.com",
  "linux.do",
  "atlassian.com",
  "jira.com",
  "confluence.com",
  "bitbucket.org",
  "gitlab.com",
  "heroku.com",
  "netlify.com",
  "vercel.com",
  "openai.com",
  "chatgpt.com",
  "oaistatic.com",
  "anthropic.com",
  "claude.ai",
  "notion.so",
  "airtable.com",
  "zoom.us",
  "zoomgov.com",
  "slack.com",
  "dropbox.com",
  "youtubekids.com",
  "youtube-nocookie.com",
  "googledrive.com",
].map((domain) => ({ id: domain, domain, strategy: "proxy", enabled: true, note: "默认代理" }));

export const defaultProfile: ProxyProfile = {
  id: "default",
  name: "默认代理",
  host: "127.0.0.1",
  port: 1080,
  bypassLocal: true,
  bypassList: [
    "127.0.0.1",
    "localhost",
    "10.*",
    "172.16.*",
    "172.17.*",
    "172.18.*",
    "172.19.*",
    "172.20.*",
    "172.21.*",
    "172.22.*",
    "172.23.*",
    "172.24.*",
    "172.25.*",
    "172.26.*",
    "172.27.*",
    "172.28.*",
    "172.29.*",
    "172.30.*",
    "172.31.*",
    "192.168.*",
    "169.254.*",
  ],
  pacRules: defaultRules,
  removedBuiltinDirectDomains: [],
  disabledBuiltinDirectDomains: [],
  mode: "manual",
};

export const defaultUnifiedLists: UnifiedLists = {
  directEnabled: false,
  directDomains: defaultProfile.bypassList.slice(),
  proxyEnabled: false,
  proxyDomains: defaultRules.map((r) => r.domain),
};

export const mockState: ProxyState = {
  mode: "manual",
  address: "127.0.0.1:1080",
  pacUrl: "http://127.0.0.1:18765/proxy.pac",
  platform: "Windows / macOS / Linux",
  capabilities: {
    manualProxy: true,
    pacProxy: true,
    tray: true,
    globalShortcut: false,
    autoStart: false,
    requiresElevatedPermission: false,
    details: ["Windows", "macOS", "Linux", "系统代理写入"],
  },
};

export const defaultSpeedTestConfig: SpeedTestConfig = {
  downloadUrl: "https://speed.cloudflare.com/__down?bytes=1048576",
  downloadBytesLimit: 1_048_576,
};

export async function getProxyState(): Promise<ProxyState> {
  if (!isTauri) return mockState;
  return invoke<ProxyState>("get_proxy_state");
}

export async function getQuickSiteIcon(siteId: string, domain: string, fallbackUrl: string): Promise<string> {
  if (!isTauri) return fallbackUrl;
  return invoke<string>("get_quick_site_icon", { siteId, domain });
}

export async function listenProxyStateChanged(onStateChange: (state: ProxyState) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  return listen<ProxyState>("proxy-state-changed", (event) => onStateChange(event.payload));
}

export async function appendAppLog(level: AppLogLevel, message: string, timestamp: string): Promise<void> {
  if (!isTauri) return;
  return invoke<void>("append_app_log", { level, message, timestamp });
}

export async function getActiveProfile(): Promise<ProxyProfile> {
  if (!isTauri) return defaultProfile;
  return invoke<ProxyProfile>("get_active_profile");
}

export async function saveProfile(profile: ProxyProfile): Promise<ProxyProfile> {
  if (!isTauri) return profile;
  return invoke<ProxyProfile>("save_profile", { profile });
}

export async function getUnifiedLists(): Promise<UnifiedLists> {
  if (!isTauri) {
    return {
      ...defaultUnifiedLists,
      directDomains: [...defaultUnifiedLists.directDomains],
      proxyDomains: [...defaultUnifiedLists.proxyDomains],
    };
  }
  return invoke<UnifiedLists>("get_unified_lists");
}

export async function saveUnifiedLists(lists: UnifiedLists): Promise<UnifiedLists> {
  if (!isTauri) return lists;
  return invoke<UnifiedLists>("save_unified_lists", { lists });
}

export async function enableManual(profile: ProxyProfile): Promise<ProxyState> {
  if (!isTauri) return { ...mockState, mode: "manual", address: `${profile.host}:${profile.port}` };
  return invoke<ProxyState>("enable_manual", { profile });
}

export async function enablePac(profile: ProxyProfile): Promise<ProxyState> {
  if (!isTauri) return { ...mockState, mode: "pac", address: undefined };
  return invoke<ProxyState>("enable_pac", { profile });
}

export async function disableProxy(): Promise<ProxyState> {
  if (!isTauri) return { ...mockState, mode: "off", address: undefined, pacUrl: undefined };
  return invoke<ProxyState>("disable_proxy");
}

export async function testProxy(profile: ProxyProfile): Promise<TestResult> {
  if (!isTauri) return { ok: true, latencyMs: 32, message: "代理连接测试成功" };
  return invoke<TestResult>("test_proxy", { profile });
}

export async function refreshIpInfo(useProxy: boolean): Promise<IpInfo> {
  if (!isTauri) {
    return useProxy
      ? { ip: "198.51.100.23", location: "美国 加利福尼亚州 圣何塞", latencyMs: 32, source: "mock" }
      : { ip: "203.0.113.45", location: "中国 北京 联通", source: "mock" };
  }
  return invoke<IpInfo>("refresh_ip_info", { useProxy });
}

export async function openGoogle(): Promise<void> {
  if (!isTauri) {
    window.open("https://www.google.com/", "_blank", "noopener,noreferrer");
    return;
  }
  return invoke<void>("open_google");
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauri) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  return invoke<void>("open_external_url", { url });
}

export async function openConfigDirectory(): Promise<void> {
  if (!isTauri) return;
  return invoke<void>("open_config_dir");
}

export async function getConfigDirectory(): Promise<string> {
  if (!isTauri) return "%APPDATA%\\proxy-manager-next";
  return invoke<string>("get_config_dir");
}

export async function showMainWindowFromTray(): Promise<void> {
  if (!isTauri) return;
  return invoke<void>("show_main_window_from_tray");
}

export async function hideTrayPanel(): Promise<void> {
  if (!isTauri) return;
  return invoke<void>("hide_tray_panel_from_ui");
}

export async function quitFromTray(): Promise<void> {
  if (!isTauri) return;
  return invoke<void>("quit_from_tray");
}

export async function runProxySpeedTest(profile: ProxyProfile, config: SpeedTestConfig): Promise<SpeedTestResult> {
  if (!isTauri) {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    return {
      ok: true,
      latencyMs: 42,
      downloadMbps: 37.8,
      downloadedBytes: config.downloadBytesLimit,
      durationMs: 940,
      message: "",
    };
  }
  return invoke<SpeedTestResult>("run_proxy_speed_test", { profile, config });
}

export async function getNetworkTrafficSample(): Promise<NetworkTrafficSample> {
  if (!isTauri) {
    const timestampMs = Date.now();
    const elapsedSeconds = Math.max((timestampMs - mockTrafficUpdatedAt) / 1000, 0);
    const phase = timestampMs / 1000;
    const downloadRate = (420 + (Math.sin(phase * 0.72) + 1) * 560) * 1024;
    const uploadRate = (90 + (Math.cos(phase * 0.91) + 1) * 180) * 1024;
    mockTrafficReceivedBytes += Math.round(downloadRate * elapsedSeconds);
    mockTrafficSentBytes += Math.round(uploadRate * elapsedSeconds);
    mockTrafficUpdatedAt = timestampMs;
    return {
      receivedBytes: mockTrafficReceivedBytes,
      sentBytes: mockTrafficSentBytes,
      timestampMs,
    };
  }
  return invoke<NetworkTrafficSample>("get_network_traffic_sample");
}

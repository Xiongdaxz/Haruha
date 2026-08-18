import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  AppLogLevel,
  DirectIpInfo,
  IpInfo,
  NetworkTrafficSample,
  ProxyMode,
  ProxyProfile,
  ProxyState,
  SavedConfiguration,
  SpeedTestConfig,
  SpeedTestProgress,
  SpeedTestResult,
  SpeedTestTarget,
  TestResult,
  TrafficMonitorCapability,
  TrafficMonitorSnapshot,
  UnifiedLists,
  UpdateApplyResult,
  UpdateCheckResult,
  UpdateDownloadProgress,
  PreparedUpdate,
} from "./types";
import packageMetadata from "../../package.json";

const isTauri = "__TAURI_INTERNALS__" in window;
const mockUpdateMode = !isTauri ? new URLSearchParams(window.location.search).get("mockUpdate") : null;
const mockTrafficApplicationLimit = (() => {
  if (isTauri) return undefined;
  const rawLimit = new URLSearchParams(window.location.search).get("mockTrafficApplications");
  if (rawLimit === null) return undefined;
  const parsed = Number(rawLimit);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
})();
const mockTrafficRankingShift =
  !isTauri && new URLSearchParams(window.location.search).get("mockTrafficRanking") === "shift";
let mockTrafficReceivedBytes = 8 * 1024 * 1024 * 1024;
let mockTrafficSentBytes = 2 * 1024 * 1024 * 1024;
let mockTrafficUpdatedAt = Date.now();
let mockTrafficMonitorStartedAt: number | null = null;

export const defaultProxyDomains: string[] = [
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
];

export const defaultDirectDomains: string[] = [
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
  ".cn",
  ".com.cn",
  ".net.cn",
  ".org.cn",
  "baidu.com",
  "qq.com",
  "163.com",
  "126.com",
  "taobao.com",
  "tmall.com",
  "jd.com",
  "alipay.com",
  "weibo.com",
  "wechat.com",
  "weixin.qq.com",
  "bilibili.com",
  "youku.com",
  "iqiyi.com",
  "aliyun.com",
  "tencent.com",
  "huawei.com",
];

export const defaultProfile: ProxyProfile = {
  id: "default",
  name: "默认代理",
  host: "192.168.0.6",
  port: 10808,
  bypassLocal: true,
  mode: "off",
};

export const defaultUnifiedLists: UnifiedLists = {
  directEnabled: false,
  directDomains: defaultDirectDomains.slice(),
  disabledDirectDomains: [],
  proxyEnabled: false,
  proxyDomains: defaultProxyDomains.slice(),
  disabledProxyDomains: [],
};

export const mockState: ProxyState = {
  mode: "off",
  address: undefined,
  pacUrl: undefined,
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
  downloadUrl: "https://speed.cloudflare.com/__down?bytes=10485760",
  directDownloadUrl: "https://mirrors.cloud.tencent.com/ubuntu/ls-lR.gz",
  downloadBytesLimit: 10_485_760,
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
      disabledDirectDomains: [...defaultUnifiedLists.disabledDirectDomains],
      proxyDomains: [...defaultUnifiedLists.proxyDomains],
      disabledProxyDomains: [...defaultUnifiedLists.disabledProxyDomains],
    };
  }
  return invoke<UnifiedLists>("get_unified_lists");
}

export async function saveUnifiedLists(lists: UnifiedLists): Promise<UnifiedLists> {
  if (!isTauri) return lists;
  return invoke<UnifiedLists>("save_unified_lists", { lists });
}

export async function saveConfiguration(
  profile: ProxyProfile,
  lists: UnifiedLists,
): Promise<SavedConfiguration> {
  if (!isTauri) {
    return {
      profile,
      unifiedLists: lists,
      proxyState: {
        ...mockState,
        mode: profile.mode,
        address: profile.mode === "manual" ? `${profile.host}:${profile.port}` : undefined,
        pacUrl: profile.mode === "pac" ? "http://127.0.0.1:18765/proxy.pac" : undefined,
      },
    };
  }
  return invoke<SavedConfiguration>("save_configuration", { profile, lists });
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

export async function setProxyMode(mode: ProxyMode): Promise<ProxyState> {
  if (!isTauri) {
    return {
      ...mockState,
      mode,
      address: mode === "manual" ? `${defaultProfile.host}:${defaultProfile.port}` : undefined,
      pacUrl: mode === "pac" ? "http://127.0.0.1:18765/proxy.pac" : undefined,
    };
  }
  return invoke<ProxyState>("set_proxy_mode", { mode });
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

export async function refreshDirectIpInfo(): Promise<DirectIpInfo> {
  if (!isTauri) {
    return {
      ipv4: { ip: "203.0.113.45", location: "中国 北京 联通", latencyMs: 84, source: "mock-v4" },
      ipv6: { ip: "2001:db8:391:c18:1bf::45", location: "中国 浙江 杭州 电信", latencyMs: 112, source: "mock-v6" },
    };
  }
  return invoke<DirectIpInfo>("refresh_direct_ip_info");
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
  if (!isTauri) return "%APPDATA%\\Haruha";
  return invoke<string>("get_config_dir");
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!isTauri) {
    await new Promise((resolve) => window.setTimeout(resolve, 550));
    if (mockUpdateMode === "error") throw new Error("无法连接更新服务器，请检查网络后重试");
    const checkedAtMs = Date.now();
    if (mockUpdateMode === "available") {
      return {
        currentVersion: packageMetadata.version,
        latestVersion: "0.1.4",
        checkedAtMs,
        update: {
          version: "0.1.4",
          tagName: "v0.1.4",
          publishedAt: "2026-08-18T02:30:00Z",
          notes: ["支持便携版应用内更新", "完善 IPv4 与 IPv6 出口展示", "优化托盘与代理状态体验"],
          sizeBytes: 18_600_000,
          assetName: "Haruha-v0.1.4-Windows-x64-Portable.exe",
          architecture: "x64",
          installKind: "portable",
        },
      };
    }
    return {
      currentVersion: packageMetadata.version,
      latestVersion: packageMetadata.version,
      checkedAtMs,
      update: null,
    };
  }
  return invoke<UpdateCheckResult>("check_for_updates");
}

export async function downloadUpdate(
  onProgress?: (progress: UpdateDownloadProgress) => void,
): Promise<PreparedUpdate> {
  if (!isTauri) {
    const totalBytes = 18_600_000;
    const startedAt = performance.now();
    for (const percent of [4, 12, 24, 39, 55, 68, 81, 92, 100]) {
      await new Promise((resolve) => window.setTimeout(resolve, 170));
      const downloadedBytes = Math.round((totalBytes * percent) / 100);
      onProgress?.({
        version: "0.1.4",
        downloadedBytes,
        totalBytes,
        bytesPerSecond: downloadedBytes / Math.max((performance.now() - startedAt) / 1000, 0.001),
        percent,
      });
    }
    return { version: "0.1.4", sizeBytes: totalBytes, fileName: "Haruha-v0.1.4-Windows-x64-Portable.exe" };
  }
  const unlisten = await listen<UpdateDownloadProgress>("update-download-progress", (event) => {
    onProgress?.(event.payload);
  });
  try {
    return await invoke<PreparedUpdate>("download_update");
  } finally {
    unlisten();
  }
}

export async function cancelUpdateDownload(): Promise<void> {
  if (!isTauri) return;
  return invoke<void>("cancel_update_download");
}

export async function installUpdate(): Promise<string> {
  if (!isTauri) return "0.1.4";
  return invoke<string>("install_update");
}

export async function getLastUpdateResult(): Promise<UpdateApplyResult | null> {
  if (!isTauri) return null;
  return invoke<UpdateApplyResult | null>("get_last_update_result");
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

export async function runNetworkSpeedTest(
  profile: ProxyProfile,
  config: SpeedTestConfig,
  target: SpeedTestTarget,
  onProgress?: (progress: SpeedTestProgress) => void,
): Promise<SpeedTestResult> {
  const requestConfig = {
    downloadUrl: target === "proxy" ? config.downloadUrl : config.directDownloadUrl,
    downloadBytesLimit: config.downloadBytesLimit,
  };
  if (!isTauri) {
    const finalMbps = target === "proxy" ? 37.8 : 82.6;
    const latencyMs = target === "proxy" ? 42 : 24;
    const startedAt = performance.now();
    for (const ratio of [0.08, 0.2, 0.38, 0.58, 0.76, 0.9, 1]) {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      onProgress?.({
        target,
        latencyMs,
        downloadMbps: finalMbps * ratio,
        downloadedBytes: Math.round(requestConfig.downloadBytesLimit * ratio),
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }
    return {
      ok: true,
      latencyMs,
      downloadMbps: finalMbps,
      downloadedBytes: requestConfig.downloadBytesLimit,
      durationMs: Math.round(performance.now() - startedAt),
      message: "",
    };
  }
  const unlisten = await listen<SpeedTestProgress>("speed-test-progress", (event) => {
    if (event.payload.target === target) onProgress?.(event.payload);
  });
  try {
    return target === "proxy"
      ? await invoke<SpeedTestResult>("run_proxy_speed_test", { profile, config: requestConfig })
      : await invoke<SpeedTestResult>("run_direct_speed_test", { config: requestConfig });
  } finally {
    unlisten();
  }
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

export async function getTrafficMonitorCapability(): Promise<TrafficMonitorCapability> {
  if (!isTauri) return { supported: true, requiresElevation: true };
  return invoke<TrafficMonitorCapability>("get_traffic_monitor_capability");
}

export async function startTrafficMonitor(): Promise<TrafficMonitorSnapshot> {
  if (!isTauri) {
    mockTrafficMonitorStartedAt = Date.now();
    return mockTrafficMonitorSnapshot();
  }
  return invoke<TrafficMonitorSnapshot>("start_traffic_monitor");
}

export async function getTrafficMonitorSnapshot(): Promise<TrafficMonitorSnapshot> {
  if (!isTauri) return mockTrafficMonitorSnapshot();
  return invoke<TrafficMonitorSnapshot>("get_traffic_monitor_snapshot");
}

export async function stopTrafficMonitor(): Promise<TrafficMonitorSnapshot> {
  if (!isTauri) {
    mockTrafficMonitorStartedAt = null;
    return mockTrafficMonitorSnapshot();
  }
  return invoke<TrafficMonitorSnapshot>("stop_traffic_monitor");
}

export async function getTrafficApplicationIcon(applicationId: string): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("get_traffic_application_icon", { applicationId });
}

function mockTrafficMonitorSnapshot(): TrafficMonitorSnapshot {
  const updatedAtMs = Date.now();
  if (mockTrafficMonitorStartedAt === null) {
    return {
      status: "idle",
      updatedAtMs,
      applications: [],
    };
  }
  const elapsedSeconds = Math.max((updatedAtMs - mockTrafficMonitorStartedAt) / 1000, 1);
  const mockApplications = [
    ["mock-chrome", "Google Chrome", 8, 1_820_000, 126_000],
    ["mock-wechat", "微信", 4, 540_000, 92_000],
    ["mock-code", "Visual Studio Code", 7, 210_000, 64_000],
    ["mock-edge", "Microsoft Edge WebView2 Runtime Helper Process (64-bit)", 5, 128_000, 36_000],
    ["mock-cloud", "OneDrive", 3, 76_000, 118_000],
    ["system-unknown", "系统/未知", 2, 44_000, 31_000],
    ["mock-qq", "QQ", 3, 39_000, 18_000],
  ].slice(0, mockTrafficApplicationLimit).map(([id, name, processCount, downloadRate, uploadRate]) => {
    const rankingMultiplier =
      mockTrafficRankingShift && elapsedSeconds >= 5 && id === "mock-qq" ? 80 : 1;
    const downloadBytes = Math.round(Number(downloadRate) * elapsedSeconds * rankingMultiplier);
    const uploadBytes = Math.round(Number(uploadRate) * elapsedSeconds * rankingMultiplier);
    return {
      id: String(id),
      name: String(name),
      processCount: Number(processCount),
      downloadBytes,
      uploadBytes,
      totalBytes: downloadBytes + uploadBytes,
    };
  });
  return {
    status: "running",
    startedAtMs: mockTrafficMonitorStartedAt,
    updatedAtMs,
    applications: mockApplications.sort((left, right) => right.totalBytes - left.totalBytes),
  };
}

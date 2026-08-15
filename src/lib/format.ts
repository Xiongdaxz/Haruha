import type { ProxyMode } from "./types";

export function modeLabel(mode: ProxyMode) {
  if (mode === "manual") return "手动代理已启用";
  if (mode === "pac") return "PAC自动代理已启用";
  return "代理已关闭";
}

export function ruleTypeLabel(value: string) {
  const v = value.trim();
  if (v === "localhost" || v === "127.0.0.1" || v === "::1") return "本机";
  if (v.includes("://")) return "URL通配";
  if (/^\*\.[^*?/:]+(?:\.[^*?/:]+)*$/.test(v)) return "域名";
  if (v.includes("*") || v.includes("?")) return "通配";
  if (/^\d{1,3}(\.\d{1,3}){3}\/\d+$/.test(v) || (v.includes(":") && v.includes("/"))) return "网段";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return "IPv4";
  if (v.includes(":")) return "IPv6";
  return "域名";
}

export function formatMbps(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未测试";
  if (value >= 100) return `${value.toFixed(0)} Mbps`;
  if (value >= 10) return `${value.toFixed(1)} Mbps`;
  return `${value.toFixed(2)} Mbps`;
}

export const speedLevelOptions = [
  { description: "适合文字消息与轻量网页", label: "单车", minMbps: 0, range: "< 1 Mbps", rank: 1 },
  { description: "适合网页浏览与标清视频", label: "摩托", minMbps: 1, range: "1–5 Mbps", rank: 2 },
  { description: "适合高清视频与日常下载", label: "汽车", minMbps: 5, range: "5–20 Mbps", rank: 3 },
  { description: "高清视频流畅，大文件下载较快", label: "高铁", minMbps: 20, range: "20–50 Mbps", rank: 4 },
  { description: "适合 4K 视频与高速下载", label: "客机", minMbps: 50, range: "50–100 Mbps", rank: 5 },
  { description: "适合多设备 4K 与大型文件", label: "火箭", minMbps: 100, range: "≥ 100 Mbps", rank: 6 },
] as const;

export function getSpeedLevel(downloadMbps?: number) {
  if (typeof downloadMbps !== "number" || !Number.isFinite(downloadMbps) || downloadMbps <= 0) {
    return { label: "等待评级", rank: 0 } as const;
  }
  for (let index = speedLevelOptions.length - 1; index >= 0; index -= 1) {
    const option = speedLevelOptions[index];
    if (downloadMbps >= option.minMbps) return option;
  }
  return speedLevelOptions[0];
}

export function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

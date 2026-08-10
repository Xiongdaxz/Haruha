import type { ProxyMode } from "./types";

export function modeLabel(mode: ProxyMode) {
  if (mode === "manual") return "手动代理已启用";
  if (mode === "pac") return "PAC自动代理已启用";
  return "代理已关闭";
}

export function bypassTypeLabel(value: string) {
  if (value === "localhost" || value === "127.0.0.1") return "本机";
  if (value.includes(":")) return "IPv6";
  if (value.includes("*")) return "通配";
  if (/^\d+\./.test(value)) return "网段";
  return "域名";
}

export function formatMbps(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "未测试";
  if (value >= 100) return `${value.toFixed(0)} Mbps`;
  if (value >= 10) return `${value.toFixed(1)} Mbps`;
  return `${value.toFixed(2)} Mbps`;
}

export function formatBytes(value: number) {
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

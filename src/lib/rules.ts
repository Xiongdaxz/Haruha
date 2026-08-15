import { getDomain } from "tldts";

export function normalizeRuleInput(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .trim()
    .replace(/^\*\./, "")
    .replace(/^\./, "")
    .toLowerCase();
}

function hostnameFromUrl(value: string) {
  if (value.includes("*")) return null;
  const questionMarkIndex = value.indexOf("?");
  if (questionMarkIndex >= 0 && !/[=&]/.test(value.slice(questionMarkIndex + 1))) return null;
  const candidate = value.startsWith("//") ? `https:${value}` : value;
  if (!/^https?:\/\//i.test(candidate)) return null;

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    return hostname || null;
  } catch {
    return null;
  }
}

// 输入框只负责清理完整 HTTP(S) URL，保留当前主机名；是否转换为
// 主域名通配符由添加确认步骤决定。
export function normalizeUnifiedRuleInput(value: string) {
  const normalized = value.trim().toLowerCase();
  return hostnameFromUrl(normalized) ?? normalized;
}

export interface UnifiedRuleAddOptions {
  singleDomain: string;
  wildcardDomain: string;
}

export function unifiedRuleAddOptions(value: string): UnifiedRuleAddOptions | null {
  const singleDomain = normalizeUnifiedRuleInput(value);
  if (
    !singleDomain ||
    singleDomain.includes("*") ||
    singleDomain.includes("?") ||
    singleDomain.includes("://") ||
    singleDomain.includes(":") ||
    singleDomain.includes("/") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(singleDomain) ||
    singleDomain === "localhost"
  ) {
    return null;
  }

  // Private suffixes such as github.io remain scoped to the copied tenant;
  // otherwise a wildcard could unexpectedly cover every hosted site.
  const registrableDomain = getDomain(singleDomain, { allowPrivateDomains: true });
  if (!registrableDomain) return null;
  return {
    singleDomain,
    wildcardDomain: `*.${registrableDomain}`,
  };
}

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

// 统一名单输入归一化：保留 CIDR(`/8`) 和通配符(`*` `?`) 语法，仅 trim + 转小写。
// 与 normalizeRuleInput 不同，不会剥离协议/路径/通配符，因为后端要按语法分类。
export function normalizeUnifiedRuleInput(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeBypassInput(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .split("/")[0]
    .trim()
    .toLowerCase();
}

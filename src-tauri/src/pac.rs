use crate::models::{
    classify_rule, normalize_domain_rule, parse_cidr, PacRule, PacStrategy, ProxyProfile, RuleKind,
    UnifiedLists,
};

const DIRECT_KEYWORDS: &[&str] = &[
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

pub fn normalize_rule(rule: &str) -> String {
    normalize_domain_rule(rule)
}

pub fn dedupe_rules(rules: &[PacRule]) -> Vec<PacRule> {
    let mut normalized: Vec<PacRule> = Vec::new();

    for rule in rules {
        let domain = normalize_rule(&rule.domain);
        if domain.is_empty() {
            continue;
        }
        if !normalized.iter().any(|item| item.domain == domain) {
            let mut next = rule.clone();
            next.id = domain.clone();
            next.domain = domain;
            normalized.push(next);
        }
    }

    normalized.sort_by(|left, right| {
        let left_key = (left.domain.matches('.').count(), left.domain.len());
        let right_key = (right.domain.matches('.').count(), right.domain.len());
        left_key.cmp(&right_key)
    });

    let mut deduped: Vec<PacRule> = Vec::new();
    'outer: for rule in normalized {
        for kept in &deduped {
            if rule.strategy == kept.strategy
                && (rule.domain == kept.domain
                    || rule.domain.ends_with(&format!(".{}", kept.domain)))
            {
                continue 'outer;
            }
        }
        deduped.push(rule);
    }

    deduped
}

pub fn generate(profile: &ProxyProfile, unified: &UnifiedLists) -> String {
    let proxy = format!("PROXY {}", profile.address());
    let rules = dedupe_rules(&profile.pac_rules);
    let removed_builtin_direct_domains = profile
        .removed_builtin_direct_domains
        .iter()
        .map(|domain| normalize_rule(domain))
        .collect::<std::collections::HashSet<_>>();
    let disabled_builtin_direct_domains = profile
        .disabled_builtin_direct_domains
        .iter()
        .map(|domain| normalize_rule(domain))
        .collect::<std::collections::HashSet<_>>();

    // 1. pac_rules 保持仅域名后缀（向后兼容）
    let mut proxy_domains: Vec<String> = rules
        .iter()
        .filter(|r| r.enabled && r.strategy == PacStrategy::Proxy)
        .map(|r| normalize_rule(&r.domain))
        .filter(|d| !d.is_empty())
        .collect();
    let mut direct_domains: Vec<String> = rules
        .iter()
        .filter(|r| r.enabled && r.strategy == PacStrategy::Direct)
        .map(|r| normalize_rule(&r.domain))
        .filter(|d| !d.is_empty())
        .collect();
    for kw in DIRECT_KEYWORDS {
        let normalized_keyword = normalize_rule(kw);
        if !removed_builtin_direct_domains.contains(&normalized_keyword)
            && !disabled_builtin_direct_domains.contains(&normalized_keyword)
        {
            direct_domains.push((*kw).to_string());
        }
    }

    // 2. 统一名单按语法分类：域名 / IP 网段 / Shell 通配符
    let mut proxy_cidrs: Vec<(String, String)> = Vec::new();
    let mut proxy_globs: Vec<String> = Vec::new();
    let mut direct_cidrs: Vec<(String, String)> = Vec::new();
    let mut direct_globs: Vec<String> = Vec::new();

    if unified.proxy_enabled {
        for raw in &unified.proxy_domains {
            collect_unified_rule(raw, &mut proxy_domains, &mut proxy_cidrs, &mut proxy_globs);
        }
    }
    if unified.direct_enabled {
        for raw in &unified.direct_domains {
            collect_unified_rule(
                raw,
                &mut direct_domains,
                &mut direct_cidrs,
                &mut direct_globs,
            );
        }
    }

    let proxy_domains_js = js_string_array(&proxy_domains);
    let direct_domains_js = js_string_array(&direct_domains);
    let proxy_cidrs_js = js_cidr_array(&proxy_cidrs);
    let direct_cidrs_js = js_cidr_array(&direct_cidrs);
    let proxy_globs_js = js_string_array(&proxy_globs);
    let direct_globs_js = js_string_array(&direct_globs);

    format!(
        r#"// ============================================================
// Proxy Auto-Configuration (PAC) File
// 代理地址: {proxy}
// 规则类型: 域名后缀 / IP 网段(CIDR) / Shell 通配符
// 优先级: 域名按最长后缀匹配；其余 proxy 优先
// ============================================================

var PROXY = "{proxy}";
var DIRECT = "DIRECT";

var proxyDomains = [
{proxy_domains_js}
];

var directDomains = [
{direct_domains_js}
];

var proxyCidrs = [
{proxy_cidrs_js}
];

var directCidrs = [
{direct_cidrs_js}
];

var proxyGlobs = [
{proxy_globs_js}
];

var directGlobs = [
{direct_globs_js}
];

function normalizeDomainRule(rule) {{
    var d = String(rule || "").toLowerCase();
    if (d.slice(0, 2) === "*.") {{
        d = d.slice(2);
    }}
    while (d.charAt(0) === ".") {{
        d = d.slice(1);
    }}
    return d;
}}

function bestDomainMatch(host, domainList) {{
    host = String(host || "").toLowerCase();
    var best = "";
    for (var i = 0; i < domainList.length; i++) {{
        var d = normalizeDomainRule(domainList[i]);
        if (!d) {{
            continue;
        }}
        if ((host === d || host.slice(-(d.length + 1)) === "." + d) && d.length > best.length) {{
            best = d;
        }}
    }}
    return best;
}}

function matchCidrs(host, cidrList) {{
    for (var i = 0; i < cidrList.length; i++) {{
        if (isInNet(host, cidrList[i][0], cidrList[i][1])) {{
            return true;
        }}
    }}
    return false;
}}

function matchGlobs(host, url, globList) {{
    for (var i = 0; i < globList.length; i++) {{
        var pattern = globList[i];
        if (pattern.indexOf("://") >= 0) {{
            if (shExpMatch(url, pattern)) {{
                return true;
            }}
        }} else if (shExpMatch(host, pattern)) {{
            return true;
        }}
    }}
    return false;
}}

function FindProxyForURL(url, host) {{
    if (isInNet(host, "127.0.0.0", "255.0.0.0") ||
        isInNet(host, "10.0.0.0", "255.0.0.0") ||
        isInNet(host, "172.16.0.0", "255.240.0.0") ||
        isInNet(host, "192.168.0.0", "255.255.0.0")) {{
        return DIRECT;
    }}

    if (isPlainHostName(host)) {{
        return DIRECT;
    }}

    var proxyDomainMatch = bestDomainMatch(host, proxyDomains);
    var directDomainMatch = bestDomainMatch(host, directDomains);
    if (proxyDomainMatch && (!directDomainMatch || proxyDomainMatch.length >= directDomainMatch.length)) {{
        return PROXY;
    }}
    if (directDomainMatch) {{
        return DIRECT;
    }}

    if (matchCidrs(host, proxyCidrs) || matchGlobs(host, url, proxyGlobs)) {{
        return PROXY;
    }}
    if (matchCidrs(host, directCidrs) || matchGlobs(host, url, directGlobs)) {{
        return DIRECT;
    }}

    return DIRECT;
}}
"#
    )
}

fn collect_unified_rule(
    raw: &str,
    domains: &mut Vec<String>,
    cidrs: &mut Vec<(String, String)>,
    globs: &mut Vec<String>,
) {
    let value = raw.trim();
    if value.is_empty() {
        return;
    }
    match classify_rule(value) {
        RuleKind::Cidr => {
            if let Some((net, mask)) = parse_cidr(value) {
                cidrs.push((net, mask));
            }
        }
        RuleKind::Glob => {
            globs.push(value.to_string());
        }
        RuleKind::Domain => {
            let normalized = normalize_rule(value);
            if !normalized.is_empty() {
                domains.push(normalized);
            }
        }
    }
}

fn js_string_array(items: &[String]) -> String {
    items
        .iter()
        .map(|s| format!("    \"{}\",", js_escape(s)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn js_cidr_array(items: &[(String, String)]) -> String {
    items
        .iter()
        .map(|(net, mask)| format!("    [\"{}\", \"{}\"],", js_escape(net), js_escape(mask)))
        .collect::<Vec<_>>()
        .join("\n")
}

fn js_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use crate::models::{
        classify_rule, default_profile, parse_cidr, rule_works_in_manual, PacRule, PacStrategy,
        RuleKind, UnifiedLists,
    };

    use super::{dedupe_rules, generate, normalize_rule};

    fn empty_unified() -> UnifiedLists {
        UnifiedLists::default()
    }

    #[test]
    fn normalizes_domain_rules() {
        assert_eq!(normalize_rule("*.Google.COM/"), "google.com");
        assert_eq!(normalize_rule(".github.com"), "github.com");
    }

    #[test]
    fn filters_rules_for_manual_mode() {
        // 域名：Manual 生效
        assert!(rule_works_in_manual("google.com"));
        assert!(rule_works_in_manual(".github.com"));
        // host 通配符（不含 ://）：Manual 生效
        assert!(rule_works_in_manual("*.internal.test"));
        // CIDR：Manual 不生效
        assert!(!rule_works_in_manual("10.0.0.0/8"));
        // URL 通配符（含 ://）：Manual 不生效
        assert!(!rule_works_in_manual("http://*.jpg"));
    }

    #[test]
    fn dedupes_child_domains_when_parent_exists() {
        let rules = vec![
            PacRule {
                id: "a".into(),
                domain: "google.com".into(),
                strategy: PacStrategy::Proxy,
                enabled: true,
                note: None,
            },
            PacRule {
                id: "b".into(),
                domain: "mail.google.com".into(),
                strategy: PacStrategy::Proxy,
                enabled: true,
                note: None,
            },
        ];

        let deduped = dedupe_rules(&rules);
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].domain, "google.com");
    }

    #[test]
    fn classifies_rules_correctly() {
        assert_eq!(classify_rule("google.com"), RuleKind::Domain);
        assert_eq!(classify_rule("*.example.com"), RuleKind::Glob);
        assert_eq!(classify_rule("http://*.jpg"), RuleKind::Glob);
        assert_eq!(classify_rule("10.0.0.0/8"), RuleKind::Cidr);
        assert_eq!(classify_rule("192.168.1.0/255.255.255.0"), RuleKind::Cidr);
        assert_eq!(classify_rule("not-an-ip/8"), RuleKind::Domain);
    }

    #[test]
    fn parses_cidr_notation() {
        assert_eq!(
            parse_cidr("10.0.0.0/8"),
            Some(("10.0.0.0".to_string(), "255.0.0.0".to_string()))
        );
        assert_eq!(
            parse_cidr("192.168.1.0/24"),
            Some(("192.168.1.0".to_string(), "255.255.255.0".to_string()))
        );
        assert_eq!(
            parse_cidr("172.16.0.0/255.240.0.0"),
            Some(("172.16.0.0".to_string(), "255.240.0.0".to_string()))
        );
        assert_eq!(parse_cidr("10.0.0.0/33"), None);
        assert_eq!(parse_cidr("not-a-cidr"), None);
    }

    #[test]
    fn generates_expected_pac_content() {
        let content = generate(&default_profile(), &empty_unified());
        assert!(content.contains("PROXY 127.0.0.1:1080"));
        assert!(content.contains("\"google.com\""));
        assert!(content.contains("FindProxyForURL"));
        assert!(content.contains("bestDomainMatch"));
        assert!(content.contains("proxyDomainMatch.length >= directDomainMatch.length"));
        assert!(content.contains("normalizeDomainRule"));
        assert!(content.contains("matchCidrs"));
        assert!(content.contains("matchGlobs"));
        assert!(content.contains("shExpMatch"));
    }

    #[test]
    fn excludes_removed_builtin_direct_domains_and_restores_by_clearing_them() {
        let mut profile = default_profile();
        profile.removed_builtin_direct_domains = vec!["*.BAIDU.COM".into()];

        let removed_content = generate(&profile, &empty_unified());
        assert!(!removed_content.contains("\"baidu.com\""));
        assert!(removed_content.contains("\"qq.com\""));

        profile.removed_builtin_direct_domains.clear();
        let restored_content = generate(&profile, &empty_unified());
        assert!(restored_content.contains("\"baidu.com\""));
    }

    #[test]
    fn excludes_disabled_builtin_direct_domains_and_restores_by_clearing_them() {
        let mut profile = default_profile();
        profile.disabled_builtin_direct_domains = vec!["*.BAIDU.COM".into()];

        let disabled_content = generate(&profile, &empty_unified());
        assert!(!disabled_content.contains("\"baidu.com\""));
        assert!(disabled_content.contains("\"qq.com\""));

        profile.disabled_builtin_direct_domains.clear();
        let restored_content = generate(&profile, &empty_unified());
        assert!(restored_content.contains("\"baidu.com\""));
    }

    #[test]
    fn injects_unified_direct_domains_when_enabled() {
        let mut unified = empty_unified();
        unified.direct_enabled = true;
        unified.direct_domains = vec!["example.test".into()];
        let content = generate(&default_profile(), &unified);
        assert!(content.contains("\"example.test\""));
    }

    #[test]
    fn injects_unified_proxy_domains_when_enabled() {
        let mut unified = empty_unified();
        unified.proxy_enabled = true;
        unified.proxy_domains = vec!["forced-proxy.test".into()];
        let content = generate(&default_profile(), &unified);
        assert!(content.contains("\"forced-proxy.test\""));
    }

    #[test]
    fn skips_unified_domains_when_disabled() {
        let mut unified = empty_unified();
        unified.direct_domains = vec!["direct-skip.test".into()];
        unified.proxy_domains = vec!["proxy-skip.test".into()];
        let content = generate(&default_profile(), &unified);
        assert!(!content.contains("direct-skip.test"));
        assert!(!content.contains("proxy-skip.test"));
    }

    #[test]
    fn injects_unified_cidr_rule_when_enabled() {
        let mut unified = empty_unified();
        unified.proxy_enabled = true;
        unified.proxy_domains = vec!["10.0.0.0/8".into()];
        let content = generate(&default_profile(), &unified);
        assert!(content.contains("[\"10.0.0.0\", \"255.0.0.0\"]"));
        assert!(content.contains("isInNet(host, cidrList[i][0], cidrList[i][1])"));
        // CIDR 不应出现在域名数组里
        assert!(!content.contains("\"10.0.0.0/8\""));
    }

    #[test]
    fn injects_unified_glob_rule_when_enabled() {
        let mut unified = empty_unified();
        unified.direct_enabled = true;
        unified.direct_domains = vec!["*.internal.test".into(), "http://*.jpg".into()];
        let content = generate(&default_profile(), &unified);
        assert!(content.contains("\"*.internal.test\""));
        assert!(content.contains("\"http://*.jpg\""));
        assert!(content.contains("shExpMatch"));
    }
}

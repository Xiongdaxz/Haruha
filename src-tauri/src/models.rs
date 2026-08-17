use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    Off,
    Manual,
    Pac,
}

/// 统一代理名单：跨 profile 共享，Manual 和 PAC 模式都可应用。
/// direct_domains（直连名单）：命中域名强制直连，Manual 和 PAC 都生效。
/// proxy_domains（代理名单）：命中域名强制走代理，仅 PAC 模式生效（Manual 受系统机制限制）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedLists {
    pub direct_enabled: bool,
    pub direct_domains: Vec<String>,
    #[serde(default)]
    pub disabled_direct_domains: Vec<String>,
    pub proxy_enabled: bool,
    pub proxy_domains: Vec<String>,
    #[serde(default)]
    pub disabled_proxy_domains: Vec<String>,
}

impl Default for UnifiedLists {
    fn default() -> Self {
        Self {
            direct_enabled: false,
            direct_domains: default_direct_domains(),
            disabled_direct_domains: Vec::new(),
            proxy_enabled: false,
            proxy_domains: default_proxy_domains(),
            disabled_proxy_domains: Vec::new(),
        }
    }
}

impl UnifiedLists {
    pub fn is_direct_rule_disabled(&self, rule: &str) -> bool {
        rule_list_contains(&self.disabled_direct_domains, rule)
    }

    pub fn is_proxy_rule_disabled(&self, rule: &str) -> bool {
        rule_list_contains(&self.disabled_proxy_domains, rule)
    }
}

/// 域名规则归一化：去除前后缀 `*.` / `.` / 末尾 `/`，转小写。
/// 供 PAC 规则和统一名单共用。
pub fn normalize_domain_rule(rule: &str) -> String {
    let mut value = rule.trim().trim_end_matches('/').to_ascii_lowercase();
    if value.starts_with("*.") {
        value = value[2..].to_string();
    } else if value.starts_with('.') {
        value = value[1..].to_string();
    }
    value
}

/// 统一名单支持的规则类型：自动按语法识别，UI 不变。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleKind {
    /// 域名后缀匹配（默认），如 `google.com` 命中 `mail.google.com`
    Domain,
    /// IP 网段（CIDR 或点分掩码），如 `10.0.0.0/8`、`192.168.1.0/255.255.255.0`
    Cidr,
    /// Shell 通配符（含 `*` 或 `?`），含 `://` 匹配 URL，否则匹配 host
    Glob,
}

/// 识别一条统一名单规则的类型。
/// - 含 `*` 或 `?` → Glob
/// - 形如 `a.b.c.d/n` 或 `a.b.c.d/a.b.c.d` → Cidr
/// - 否则 → Domain
pub fn classify_rule(rule: &str) -> RuleKind {
    let value = rule.trim();
    if value.contains('*') || value.contains('?') {
        return RuleKind::Glob;
    }
    if parse_cidr(value).is_some() {
        return RuleKind::Cidr;
    }
    RuleKind::Domain
}

/// 统一规则用于去重、停用状态关联和跨列表移动的稳定键。
pub fn unified_rule_key(rule: &str) -> String {
    let trimmed = rule.trim();
    match classify_rule(trimmed) {
        RuleKind::Domain => normalize_domain_rule(trimmed),
        RuleKind::Cidr | RuleKind::Glob => trimmed.to_ascii_lowercase(),
    }
}

pub fn rule_list_contains(rules: &[String], candidate: &str) -> bool {
    let candidate_key = unified_rule_key(candidate);
    !candidate_key.is_empty()
        && rules
            .iter()
            .any(|rule| unified_rule_key(rule) == candidate_key)
}

/// 判断规则在 Manual 模式（系统 bypass / ignore-hosts）下是否生效。
/// 系统代理 bypass 仅支持域名和 host 通配符（不含 `://`），不支持 CIDR 和 URL 通配符。
pub fn rule_works_in_manual(rule: &str) -> bool {
    match classify_rule(rule) {
        RuleKind::Domain => true,
        RuleKind::Glob => !rule.contains("://"),
        RuleKind::Cidr => false,
    }
}

/// 解析 CIDR 或点分掩码形式的 IP 网段，返回 `(network, netmask)`。
/// 仅支持 IPv4。返回值均为点分十进制字符串，可直接注入 PAC `isInNet`。
pub fn parse_cidr(rule: &str) -> Option<(String, String)> {
    let value = rule.trim();
    let (network, mask_part) = value.split_once('/')?;
    let network_octets: [u8; 4] = parse_ipv4(network)?;
    if let Some(prefix_len) = mask_part.parse::<u8>().ok() {
        if prefix_len > 32 {
            return None;
        }
        let mask = prefix_len_to_mask(prefix_len);
        return Some((format_ipv4(network_octets), format_ipv4(mask)));
    }
    let mask_octets: [u8; 4] = parse_ipv4(mask_part)?;
    Some((format_ipv4(network_octets), format_ipv4(mask_octets)))
}

fn parse_ipv4(value: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = value.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut octets = [0u8; 4];
    for (index, part) in parts.iter().enumerate() {
        octets[index] = part.parse::<u8>().ok()?;
    }
    Some(octets)
}

fn prefix_len_to_mask(prefix: u8) -> [u8; 4] {
    if prefix == 0 {
        return [0, 0, 0, 0];
    }
    let bits: u32 = !0u32 << (32 - prefix as u32);
    [
        ((bits >> 24) & 0xff) as u8,
        ((bits >> 16) & 0xff) as u8,
        ((bits >> 8) & 0xff) as u8,
        (bits & 0xff) as u8,
    ]
}

fn format_ipv4(octets: [u8; 4]) -> String {
    format!("{}.{}.{}.{}", octets[0], octets[1], octets[2], octets[3])
}

impl Default for ProxyMode {
    fn default() -> Self {
        Self::Pac
    }
}

/// 旧版 PAC 规则的代理/直连策略。仅用于读取旧配置并迁移到统一名，
/// 不再参与运行时逻辑。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PacStrategy {
    Proxy,
    Direct,
}

/// 旧版 PAC 规则条目。仅用于读取旧配置并迁移到统一名单。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PacRule {
    pub id: String,
    pub domain: String,
    pub strategy: PacStrategy,
    pub enabled: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    #[serde(default = "default_bypass_local")]
    pub bypass_local: bool,
    /// 旧版“不走代理”列表，已并入统一直连名单；保存时为空则省略，仅用于迁移。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bypass_list: Vec<String>,
    /// 旧版 PAC 规则，已并入统一名单；保存时为空则省略，仅用于迁移。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pac_rules: Vec<PacRule>,
    /// 旧版“删除的内置直连域名”，已并入统一名单；仅用于迁移。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removed_builtin_direct_domains: Vec<String>,
    /// 旧版“停用的内置直连域名”，已并入统一名单；仅用于迁移。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub disabled_builtin_direct_domains: Vec<String>,
    pub mode: ProxyMode,
}

impl ProxyProfile {
    pub fn address(&self) -> String {
        format!("{}:{}", self.host.trim(), self.port)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub manual_proxy: bool,
    pub pac_proxy: bool,
    pub tray: bool,
    pub global_shortcut: bool,
    pub auto_start: bool,
    pub requires_elevated_permission: bool,
    pub details: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyState {
    pub mode: ProxyMode,
    pub address: Option<String>,
    pub pac_url: Option<String>,
    pub platform: String,
    pub capabilities: PlatformCapabilities,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IpInfo {
    pub ip: String,
    pub location: String,
    pub latency_ms: Option<u128>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirectIpInfo {
    pub ipv4: Option<IpInfo>,
    pub ipv6: Option<IpInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub latency_ms: Option<u128>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestConfig {
    pub download_url: String,
    pub download_bytes_limit: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestResult {
    pub ok: bool,
    pub latency_ms: Option<u128>,
    pub download_mbps: Option<f64>,
    pub downloaded_bytes: Option<u64>,
    pub duration_ms: u128,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpeedTestProgress {
    pub target: String,
    pub latency_ms: u128,
    pub download_mbps: f64,
    pub downloaded_bytes: u64,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkTrafficSample {
    pub received_bytes: u64,
    pub sent_bytes: u64,
    pub timestamp_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrafficMonitorCapability {
    pub supported: bool,
    pub requires_elevation: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrafficApplicationUsage {
    pub id: String,
    pub name: String,
    pub process_count: u32,
    pub download_bytes: u64,
    pub upload_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrafficMonitorSnapshot {
    pub status: String,
    pub started_at_ms: Option<u64>,
    pub updated_at_ms: u64,
    pub applications: Vec<TrafficApplicationUsage>,
    pub error: Option<String>,
}

pub fn default_profile() -> ProxyProfile {
    ProxyProfile {
        id: "default".to_string(),
        name: "默认代理".to_string(),
        host: "192.168.0.6".to_string(),
        port: 10808,
        bypass_local: true,
        bypass_list: Vec::new(),
        pac_rules: Vec::new(),
        removed_builtin_direct_domains: Vec::new(),
        disabled_builtin_direct_domains: Vec::new(),
        // 首次启动只预填代理地址，不应在用户确认前修改系统代理。
        mode: ProxyMode::Off,
    }
}

/// 默认代理名单（仅 PAC 模式生效）。
pub fn default_proxy_domains() -> Vec<String> {
    [
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
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect()
}

/// 默认直连名单：本机/内网段 + 常用国内直连域名。
pub fn default_direct_domains() -> Vec<String> {
    let mut domains = vec![
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
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect::<Vec<_>>();
    domains.extend(default_chinese_direct_domains());
    domains
}

/// 常用国内直连域名（默认直连名单的一部分）。
pub fn default_chinese_direct_domains() -> Vec<String> {
    [
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
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect()
}

fn default_bypass_local() -> bool {
    true
}

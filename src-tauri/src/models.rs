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
    pub proxy_enabled: bool,
    pub proxy_domains: Vec<String>,
}

impl Default for UnifiedLists {
    fn default() -> Self {
        Self {
            direct_enabled: false,
            direct_domains: default_bypass_list(),
            proxy_enabled: false,
            proxy_domains: default_pac_rules().into_iter().map(|r| r.domain).collect(),
        }
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PacStrategy {
    Proxy,
    Direct,
}

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
    pub bypass_list: Vec<String>,
    pub pac_rules: Vec<PacRule>,
    #[serde(default)]
    pub removed_builtin_direct_domains: Vec<String>,
    #[serde(default)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkTrafficSample {
    pub received_bytes: u64,
    pub sent_bytes: u64,
    pub timestamp_ms: u64,
}

pub fn default_profile() -> ProxyProfile {
    ProxyProfile {
        id: "default".to_string(),
        name: "默认代理".to_string(),
        host: "127.0.0.1".to_string(),
        port: 1080,
        bypass_local: true,
        bypass_list: default_bypass_list(),
        pac_rules: default_pac_rules(),
        removed_builtin_direct_domains: Vec::new(),
        disabled_builtin_direct_domains: Vec::new(),
        mode: ProxyMode::Manual,
    }
}

pub fn default_pac_rules() -> Vec<PacRule> {
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
    .map(|domain| pac_rule(domain, PacStrategy::Proxy, "默认代理"))
    .collect()
}

pub fn starter_pac_rules() -> Vec<PacRule> {
    vec![
        pac_rule("google.com", PacStrategy::Proxy, "谷歌服务"),
        pac_rule("github.com", PacStrategy::Proxy, "GitHub"),
        pac_rule("openai.com", PacStrategy::Proxy, "OpenAI"),
        pac_rule("youtube.com", PacStrategy::Proxy, "YouTube"),
        pac_rule("x.com", PacStrategy::Direct, "X (Twitter)"),
    ]
}

pub fn default_bypass_list() -> Vec<String> {
    vec![
        "127.0.0.1".to_string(),
        "localhost".to_string(),
        "10.*".to_string(),
        "172.16.*".to_string(),
        "172.17.*".to_string(),
        "172.18.*".to_string(),
        "172.19.*".to_string(),
        "172.20.*".to_string(),
        "172.21.*".to_string(),
        "172.22.*".to_string(),
        "172.23.*".to_string(),
        "172.24.*".to_string(),
        "172.25.*".to_string(),
        "172.26.*".to_string(),
        "172.27.*".to_string(),
        "172.28.*".to_string(),
        "172.29.*".to_string(),
        "172.30.*".to_string(),
        "172.31.*".to_string(),
        "192.168.*".to_string(),
        "169.254.*".to_string(),
    ]
}

fn default_bypass_local() -> bool {
    true
}

fn pac_rule(domain: &str, strategy: PacStrategy, note: &str) -> PacRule {
    PacRule {
        id: domain.to_string(),
        domain: domain.to_string(),
        strategy,
        enabled: true,
        note: Some(note.to_string()),
    }
}

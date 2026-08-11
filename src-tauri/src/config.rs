use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::{
    models::{
        classify_rule, default_bypass_list, default_pac_rules, default_profile,
        normalize_domain_rule, starter_pac_rules, PacRule, PacStrategy, ProxyMode, ProxyProfile,
        RuleKind, UnifiedLists,
    },
    pac,
};

const CONFIG_DIR_NAME: &str = "Haruha";
const LEGACY_PROJECT_CONFIG_DIR_NAME: &str = "proxy-manager-next";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub active_profile_id: String,
    pub profiles: Vec<ProxyProfile>,
    #[serde(default)]
    pub unified_lists: UnifiedLists,
}

impl Default for AppConfig {
    fn default() -> Self {
        let profile = default_profile();
        Self {
            active_profile_id: profile.id.clone(),
            profiles: vec![profile],
            unified_lists: UnifiedLists::default(),
        }
    }
}

pub struct ConfigStore {
    path: PathBuf,
    config: AppConfig,
}

impl ConfigStore {
    pub fn load() -> Result<Self> {
        migrate_project_named_config_dir()?;
        let dir = config_dir()?;
        fs::create_dir_all(&dir).with_context(|| format!("创建配置目录失败: {}", dir.display()))?;
        let path = dir.join("config.json");

        if !path.exists() {
            if let Some(config) = migrate_legacy_config()? {
                let store = Self { path, config };
                store.save()?;
                return Ok(store);
            }
        }

        let mut config = if path.exists() {
            let raw = fs::read_to_string(&path)
                .with_context(|| format!("读取配置失败: {}", path.display()))?;
            serde_json::from_str(&raw)
                .with_context(|| format!("解析配置失败: {}", path.display()))?
        } else {
            AppConfig::default()
        };

        let upgraded = upgrade_starter_config(&mut config)?;
        let sanitized = sanitize_config(&mut config);
        let store = Self { path, config };
        if upgraded || sanitized {
            store.save()?;
        }

        Ok(store)
    }

    pub fn active_profile(&self) -> ProxyProfile {
        self.config
            .profiles
            .iter()
            .find(|profile| profile.id == self.config.active_profile_id)
            .cloned()
            .unwrap_or_else(default_profile)
    }

    pub fn unified_lists(&self) -> &UnifiedLists {
        &self.config.unified_lists
    }

    pub fn set_unified_lists(&mut self, mut lists: UnifiedLists) -> Result<UnifiedLists> {
        sanitize_unified_lists(&mut lists);
        self.config.unified_lists = lists.clone();
        self.save()?;
        Ok(lists)
    }

    pub fn save_profile(&mut self, mut profile: ProxyProfile) -> Result<ProxyProfile> {
        sanitize_profile(&mut profile);
        profile.pac_rules = pac::dedupe_rules(&profile.pac_rules);

        if let Some(existing) = self
            .config
            .profiles
            .iter_mut()
            .find(|item| item.id == profile.id)
        {
            *existing = profile.clone();
        } else {
            self.config.profiles.push(profile.clone());
        }
        self.config.active_profile_id = profile.id.clone();
        self.save()?;
        Ok(profile)
    }

    pub fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(&self.config)?;
        fs::write(&self.path, raw).with_context(|| format!("保存配置失败: {}", self.path.display()))
    }
}

pub fn config_dir() -> Result<PathBuf> {
    let base = dirs::config_dir().context("无法获取系统配置目录")?;
    Ok(base.join(CONFIG_DIR_NAME))
}

fn migrate_project_named_config_dir() -> Result<()> {
    let base = dirs::config_dir().context("无法获取系统配置目录")?;
    migrate_project_named_config_dir_from(&base)
}

fn migrate_project_named_config_dir_from(base: &Path) -> Result<()> {
    let legacy_dir = base.join(LEGACY_PROJECT_CONFIG_DIR_NAME);
    let current_dir = base.join(CONFIG_DIR_NAME);
    if current_dir.exists() || !legacy_dir.exists() {
        return Ok(());
    }

    fs::rename(&legacy_dir, &current_dir).with_context(|| {
        format!(
            "迁移配置目录失败: {} -> {}",
            legacy_dir.display(),
            current_dir.display()
        )
    })
}

pub fn pac_file_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("proxy.pac"))
}

pub fn append_app_log_line(level: &str, message: &str, timestamp: &str) -> Result<()> {
    let log_dir = config_dir()?.join("logs");
    fs::create_dir_all(&log_dir)
        .with_context(|| format!("创建日志目录失败: {}", log_dir.display()))?;
    let log_path = log_dir.join("app.log");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .with_context(|| format!("打开日志文件失败: {}", log_path.display()))?;
    let safe_level = level.replace('\r', " ").replace('\n', " ");
    let safe_message = message.replace('\r', " ").replace('\n', " ");
    let safe_timestamp = timestamp.replace('\r', " ").replace('\n', " ");
    writeln!(file, "[{safe_timestamp}] [{safe_level}] {safe_message}")
        .with_context(|| format!("写入日志文件失败: {}", log_path.display()))
}

pub fn write_pac_file(profile: &ProxyProfile, unified: &UnifiedLists) -> Result<String> {
    let content = pac::generate(profile, unified);
    let path = pac_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, &content).with_context(|| format!("写入PAC文件失败: {}", path.display()))?;
    Ok(content)
}

#[derive(Debug, Deserialize)]
struct LegacyConfig {
    proxy_ip: Option<String>,
    proxy_port: Option<String>,
    proxy_override: Option<String>,
    bypass_local: Option<bool>,
    proxy_mode: Option<String>,
    pac_rules: Option<Vec<String>>,
}

fn migrate_legacy_config() -> Result<Option<AppConfig>> {
    let candidates = legacy_candidates();
    for path in candidates {
        if !path.exists() {
            continue;
        }

        let raw = fs::read_to_string(&path)
            .with_context(|| format!("读取旧配置失败: {}", path.display()))?;
        let legacy: LegacyConfig = serde_json::from_str(&raw)
            .with_context(|| format!("解析旧配置失败: {}", path.display()))?;
        return Ok(Some(convert_legacy(legacy)));
    }
    Ok(None)
}

fn legacy_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let appdata = PathBuf::from(appdata);
        paths.push(
            appdata
                .join("system-proxy-manager")
                .join("proxy_config.json"),
        );
        paths.push(appdata.join("系统代理管理工具").join("proxy_config.json"));
    }
    paths
}

fn convert_legacy(legacy: LegacyConfig) -> AppConfig {
    let mut profile = default_profile();
    if let Some(host) = legacy.proxy_ip {
        if !host.trim().is_empty() {
            profile.host = host.trim().to_string();
        }
    }
    if let Some(port) = legacy.proxy_port {
        if let Ok(port) = port.trim().parse::<u16>() {
            profile.port = port;
        }
    }
    if let Some(bypass_local) = legacy.bypass_local {
        profile.bypass_local = bypass_local;
    }
    if let Some(proxy_override) = legacy.proxy_override {
        profile.bypass_list =
            parse_legacy_bypass(&proxy_override, legacy.bypass_local.unwrap_or(true));
    }
    if let Some(mode) = legacy.proxy_mode {
        profile.mode = match mode.as_str() {
            "manual" => ProxyMode::Manual,
            "pac" => ProxyMode::Pac,
            "off" => ProxyMode::Off,
            _ => ProxyMode::Pac,
        };
    }
    if let Some(rules) = legacy.pac_rules {
        profile.pac_rules = rules
            .into_iter()
            .filter(|rule| !rule.trim().is_empty())
            .map(|rule| PacRule {
                id: rule.trim().to_ascii_lowercase(),
                domain: rule.trim().to_ascii_lowercase(),
                strategy: PacStrategy::Proxy,
                enabled: true,
                note: None,
            })
            .collect();
    }

    AppConfig {
        active_profile_id: profile.id.clone(),
        profiles: vec![profile],
        unified_lists: UnifiedLists::default(),
    }
}

fn upgrade_starter_config(config: &mut AppConfig) -> Result<bool> {
    let profile_indexes = config
        .profiles
        .iter()
        .enumerate()
        .filter_map(|(index, profile)| is_starter_profile(profile).then_some(index))
        .collect::<Vec<_>>();

    if profile_indexes.is_empty() {
        return Ok(false);
    }

    let legacy_profile =
        migrate_legacy_config()?.and_then(|legacy| legacy.profiles.into_iter().next());

    for index in profile_indexes {
        let current = config.profiles[index].clone();
        let mut next = legacy_profile.clone().unwrap_or_else(default_profile);
        next.id = current.id;
        next.name = current.name;
        next.mode = current.mode;

        if legacy_profile.is_none() {
            if current.host.trim() != "127.0.0.1" && !current.host.trim().is_empty() {
                next.host = current.host;
            }
            if current.port != 0 {
                next.port = current.port;
            }
            next.pac_rules = default_pac_rules();
            next.bypass_list = default_bypass_list();
        }

        config.profiles[index] = next;
    }

    Ok(true)
}

fn sanitize_config(config: &mut AppConfig) -> bool {
    let mut changed = false;
    for profile in &mut config.profiles {
        changed |= sanitize_profile(profile);
    }
    changed |= sanitize_unified_lists(&mut config.unified_lists);
    changed
}

fn sanitize_profile(profile: &mut ProxyProfile) -> bool {
    let before_bypass = profile.bypass_list.len();
    profile.bypass_list.retain(|item| {
        !item.trim().eq_ignore_ascii_case("::1") && !is_retired_default_bypass_rule(item)
    });
    let bypass_changed = before_bypass != profile.bypass_list.len();

    let previous_removed_domains = profile.removed_builtin_direct_domains.clone();
    let mut seen_removed_domains = std::collections::HashSet::new();
    profile.removed_builtin_direct_domains = previous_removed_domains
        .iter()
        .map(|domain| normalize_domain_rule(domain))
        .filter(|domain| !domain.is_empty() && seen_removed_domains.insert(domain.clone()))
        .collect();

    let previous_disabled_domains = profile.disabled_builtin_direct_domains.clone();
    let removed_domains = profile
        .removed_builtin_direct_domains
        .iter()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let mut seen_disabled_domains = std::collections::HashSet::new();
    profile.disabled_builtin_direct_domains = previous_disabled_domains
        .iter()
        .map(|domain| normalize_domain_rule(domain))
        .filter(|domain| {
            !domain.is_empty()
                && !removed_domains.contains(domain)
                && seen_disabled_domains.insert(domain.clone())
        })
        .collect();

    bypass_changed
        || profile.removed_builtin_direct_domains != previous_removed_domains
        || profile.disabled_builtin_direct_domains != previous_disabled_domains
}

fn is_retired_default_bypass_rule(rule: &str) -> bool {
    normalize_domain_rule(rule) == "looklookfactory.com"
}

/// 归一化统一名单：去空、去重。按规则类型分别处理：
/// - Domain：归一化（去除 `*.` / `.` 前缀，转小写）
/// - Cidr / Glob：仅 trim + 转小写，保留原始语法
/// 返回是否有变化。
fn sanitize_unified_lists(lists: &mut UnifiedLists) -> bool {
    let before_direct = lists.direct_domains.len();
    let before_proxy = lists.proxy_domains.len();

    lists.direct_domains = dedupe_unified_rules(&lists.direct_domains)
        .into_iter()
        .filter(|rule| !is_retired_default_bypass_rule(rule))
        .collect();
    lists.proxy_domains = dedupe_unified_rules(&lists.proxy_domains);

    before_direct != lists.direct_domains.len() || before_proxy != lists.proxy_domains.len()
}

fn dedupe_unified_rules(rules: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for rule in rules {
        let trimmed = rule.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = match classify_rule(trimmed) {
            RuleKind::Domain => normalize_domain_rule(trimmed),
            RuleKind::Cidr | RuleKind::Glob => trimmed.to_ascii_lowercase(),
        };
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        result.push(trimmed.to_string());
    }
    result
}

fn is_starter_profile(profile: &ProxyProfile) -> bool {
    if profile.pac_rules.len() != starter_pac_rules().len() {
        return false;
    }

    let starter = starter_pac_rules();
    profile.pac_rules.iter().all(|rule| {
        starter.iter().any(|item| {
            rule.domain.eq_ignore_ascii_case(&item.domain) && rule.strategy == item.strategy
        })
    })
}

fn parse_legacy_bypass(value: &str, bypass_local: bool) -> Vec<String> {
    let mut items: Vec<String> = value
        .split(';')
        .map(str::trim)
        .filter(|item| !item.is_empty() && *item != "<local>")
        .map(ToOwned::to_owned)
        .collect();
    if bypass_local {
        for item in ["localhost", "127.0.0.1"] {
            if !items.iter().any(|existing| existing == item) {
                items.push(item.to_string());
            }
        }
    }
    items
}

#[allow(dead_code)]
fn path_exists(path: &Path) -> bool {
    path.exists()
}

#[cfg(test)]
mod tests {
    use super::{
        convert_legacy, is_starter_profile, migrate_project_named_config_dir_from,
        parse_legacy_bypass, sanitize_profile, sanitize_unified_lists, LegacyConfig,
    };
    use crate::models::{
        default_pac_rules, default_profile, starter_pac_rules, ProxyMode, UnifiedLists,
    };
    use std::{fs, time::SystemTime};

    #[test]
    fn migrates_project_named_config_directory_to_product_name() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("系统时间应晚于 Unix epoch")
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "haruha-config-migration-{}-{unique}",
            std::process::id()
        ));
        let legacy_dir = base.join("proxy-manager-next");
        let current_dir = base.join("Haruha");
        fs::create_dir_all(legacy_dir.join("logs")).expect("应创建旧配置目录");
        fs::write(legacy_dir.join("config.json"), "existing config").expect("应写入旧配置");
        fs::write(legacy_dir.join("logs").join("app.log"), "existing log").expect("应写入旧日志");

        migrate_project_named_config_dir_from(&base).expect("应迁移旧配置目录");

        assert!(!legacy_dir.exists());
        assert_eq!(
            fs::read_to_string(current_dir.join("config.json")).expect("应读取新配置"),
            "existing config"
        );
        assert_eq!(
            fs::read_to_string(current_dir.join("logs").join("app.log")).expect("应读取新日志"),
            "existing log"
        );

        fs::remove_dir_all(base).expect("应清理测试目录");
    }

    #[test]
    fn parses_legacy_bypass_and_local_items() {
        let items = parse_legacy_bypass("10.*;192.168.*;<local>", true);
        assert!(items.contains(&"10.*".to_string()));
        assert!(items.contains(&"localhost".to_string()));
        assert!(!items.contains(&"<local>".to_string()));
    }

    #[test]
    fn converts_legacy_config_to_profile() {
        let config = convert_legacy(LegacyConfig {
            proxy_ip: Some("192.0.2.10".into()),
            proxy_port: Some("10808".into()),
            proxy_override: None,
            bypass_local: Some(true),
            proxy_mode: Some("manual".into()),
            pac_rules: Some(vec!["google.com".into()]),
        });

        let profile = &config.profiles[0];
        assert_eq!(profile.host, "192.0.2.10");
        assert_eq!(profile.port, 10808);
        assert_eq!(profile.mode, ProxyMode::Manual);
        assert_eq!(profile.pac_rules[0].domain, "google.com");
    }

    #[test]
    fn detects_only_starter_pac_rules() {
        let mut starter = default_profile();
        starter.pac_rules = starter_pac_rules();
        assert!(is_starter_profile(&starter));

        let mut full = default_profile();
        full.pac_rules = default_pac_rules();
        assert!(!is_starter_profile(&full));
    }

    #[test]
    fn removes_windows_unsupported_ipv6_bypass_item() {
        let mut profile = default_profile();
        profile.bypass_list.push("::1".to_string());

        assert!(sanitize_profile(&mut profile));
        assert!(!profile.bypass_list.contains(&"::1".to_string()));
    }

    #[test]
    fn normalizes_builtin_direct_rule_overrides_and_removed_rules_take_priority() {
        let mut profile = default_profile();
        profile.removed_builtin_direct_domains = vec!["*.BAIDU.COM".into()];
        profile.disabled_builtin_direct_domains =
            vec![".baidu.com".into(), "*.QQ.COM".into(), "qq.com".into()];

        assert!(sanitize_profile(&mut profile));
        assert_eq!(profile.removed_builtin_direct_domains, vec!["baidu.com"]);
        assert_eq!(profile.disabled_builtin_direct_domains, vec!["qq.com"]);
    }

    #[test]
    fn removes_retired_default_bypass_domain_from_saved_config() {
        let mut profile = default_profile();
        profile
            .bypass_list
            .push("*.looklookfactory.com".to_string());
        assert!(sanitize_profile(&mut profile));
        assert!(!profile
            .bypass_list
            .iter()
            .any(|item| item.contains("looklookfactory.com")));

        let mut unified = UnifiedLists::default();
        unified
            .direct_domains
            .push("*.LOOKLOOKFACTORY.COM".to_string());
        assert!(sanitize_unified_lists(&mut unified));
        assert!(!unified
            .direct_domains
            .iter()
            .any(|item| item.to_ascii_lowercase().contains("looklookfactory.com")));
    }
}

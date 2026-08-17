use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::{
    models::{
        default_chinese_direct_domains, default_profile, normalize_domain_rule, rule_list_contains,
        unified_rule_key, PacStrategy, ProxyMode, ProxyProfile, UnifiedLists,
    },
    pac,
};

const CONFIG_DIR_NAME: &str = "Haruha";
const LEGACY_PROJECT_CONFIG_DIR_NAME: &str = "proxy-manager-next";
const CURRENT_CONFIG_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub schema_version: u32,
    pub active_profile_id: String,
    pub profiles: Vec<ProxyProfile>,
    #[serde(default)]
    pub unified_lists: UnifiedLists,
}

impl Default for AppConfig {
    fn default() -> Self {
        let profile = default_profile();
        Self {
            schema_version: CURRENT_CONFIG_SCHEMA_VERSION,
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
            if let Some(mut config) = migrate_legacy_config()? {
                let _ = migrate_profile_rules_to_unified(&mut config);
                let _ = migrate_config_schema(&mut config);
                let _ = sanitize_config(&mut config);
                let store = Self { path, config };
                store.save()?;
                return Ok(store);
            }
        }

        let mut config = if path.exists() {
            read_config_with_recovery(&path)?
        } else {
            AppConfig::default()
        };

        let migrated = migrate_profile_rules_to_unified(&mut config);
        let schema_migrated = migrate_config_schema(&mut config);
        let sanitized = sanitize_config(&mut config);
        let store = Self { path, config };
        if migrated || schema_migrated || sanitized {
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

    pub fn prepare_unified_lists(mut lists: UnifiedLists) -> UnifiedLists {
        sanitize_unified_lists(&mut lists);
        lists
    }

    pub fn set_unified_lists(&mut self, lists: UnifiedLists) -> Result<UnifiedLists> {
        let lists = Self::prepare_unified_lists(lists);
        let previous = self.config.clone();
        self.config.unified_lists = lists.clone();
        if let Err(error) = self.save() {
            self.config = previous;
            return Err(error);
        }
        Ok(lists)
    }

    pub fn prepare_profile(mut profile: ProxyProfile) -> Result<ProxyProfile> {
        sanitize_profile(&mut profile);
        validate_profile(&profile)?;
        Ok(profile)
    }

    pub fn save_profile(&mut self, profile: ProxyProfile) -> Result<ProxyProfile> {
        let profile = Self::prepare_profile(profile)?;
        let previous = self.config.clone();

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
        if let Err(error) = self.save() {
            self.config = previous;
            return Err(error);
        }
        Ok(profile)
    }

    pub fn save_configuration(
        &mut self,
        profile: ProxyProfile,
        lists: UnifiedLists,
    ) -> Result<(ProxyProfile, UnifiedLists)> {
        let profile = Self::prepare_profile(profile)?;
        let lists = Self::prepare_unified_lists(lists);
        let previous = self.config.clone();

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
        self.config.unified_lists = lists.clone();
        if let Err(error) = self.save() {
            self.config = previous;
            return Err(error);
        }
        Ok((profile, lists))
    }

    pub fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let raw = serde_json::to_string_pretty(&self.config)?;
        save_config_atomically(&self.path, raw.as_bytes())
            .with_context(|| format!("保存配置失败: {}", self.path.display()))
    }
}

fn backup_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy())
        .unwrap_or_default();
    path.with_file_name(format!("{file_name}.bak"))
}

fn read_config(path: &Path) -> Result<AppConfig> {
    let raw =
        fs::read_to_string(path).with_context(|| format!("读取配置失败: {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("解析配置失败: {}", path.display()))
}

fn read_config_with_recovery(path: &Path) -> Result<AppConfig> {
    let raw =
        fs::read_to_string(path).with_context(|| format!("读取配置失败: {}", path.display()))?;
    match serde_json::from_str(&raw) {
        Ok(config) => Ok(config),
        Err(primary_error) => {
            let backup = backup_path(path);
            if backup.exists() {
                if let Ok(config) = read_config(&backup) {
                    let restored = serde_json::to_vec_pretty(&config)?;
                    atomic_write(path, &restored)
                        .with_context(|| format!("从备份恢复配置失败: {}", backup.display()))?;
                    eprintln!(
                        "检测到配置文件损坏，已从备份恢复: {} -> {}",
                        backup.display(),
                        path.display()
                    );
                    return Ok(config);
                }
            }

            let quarantine = corrupted_config_path(path);
            atomic_write(&quarantine, raw.as_bytes())
                .with_context(|| format!("保留损坏配置失败: {}", quarantine.display()))?;
            let config = AppConfig::default();
            let restored = serde_json::to_vec_pretty(&config)?;
            atomic_write(path, &restored)
                .with_context(|| format!("重建默认配置失败: {}", path.display()))?;
            eprintln!(
                "配置文件损坏且没有可用备份，已保留至 {} 并重建安全默认配置；解析错误: {primary_error}",
                quarantine.display()
            );
            Ok(config)
        }
    }
}

fn corrupted_config_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy())
        .unwrap_or_default();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    path.with_file_name(format!("{file_name}.corrupt-{timestamp}"))
}

fn save_config_atomically(path: &Path, content: &[u8]) -> Result<()> {
    if path.exists() {
        if let Ok(current) = fs::read(path) {
            if serde_json::from_slice::<AppConfig>(&current).is_ok() {
                atomic_write(&backup_path(path), &current)?;
            }
        }
    }
    atomic_write(path, content)
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<()> {
    let parent = path.parent().context("配置文件缺少父目录")?;
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy())
        .unwrap_or_default();
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        unique
    ));

    let result = (|| -> Result<()> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(content)?;
        file.flush()?;
        drop(file);
        replace_file(&temporary, path)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<()> {
    fs::rename(source, destination)?;
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING};

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let succeeded = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING,
        )
    };
    if succeeded == 0 {
        bail!("原子替换配置失败: {}", std::io::Error::last_os_error());
    }
    Ok(())
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
    atomic_write(&path, content.as_bytes())
        .with_context(|| format!("写入PAC文件失败: {}", path.display()))?;
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
    let mut unified = UnifiedLists::default();
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
        unified.direct_domains =
            parse_legacy_bypass(&proxy_override, legacy.bypass_local.unwrap_or(true));
        unified.direct_enabled = !unified.direct_domains.is_empty();
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
        unified.proxy_domains = rules
            .into_iter()
            .filter(|rule| !rule.trim().is_empty())
            .map(|rule| rule.trim().to_ascii_lowercase())
            .collect();
        unified.proxy_enabled = !unified.proxy_domains.is_empty();
    }

    AppConfig {
        schema_version: 0,
        active_profile_id: profile.id.clone(),
        profiles: vec![profile],
        unified_lists: unified,
    }
}

/// 迁移旧版 per-profile 的 `pac_rules` / `bypass_list` 与内置直连覆盖到统一名单，随后清空旧字段。
/// - `pac_rules(proxy)` → 代理名单；`pac_rules(direct)` / `bypass_list` → 直连名单。
/// - 旧版逐条停用状态迁移到统一名单的 disabled_* 字段；删除的内置直连仍保持删除。
/// - 旧版配置会把常用国内直连域名并入直连名单（保留“国内直连”默认行为）。
fn migrate_profile_rules_to_unified(config: &mut AppConfig) -> bool {
    let mut proxy_domains: Vec<String> = Vec::new();
    let mut direct_domains: Vec<String> = Vec::new();
    let mut disabled_proxy_domains: Vec<String> = Vec::new();
    let mut disabled_direct_domains: Vec<String> = Vec::new();
    let mut removed_direct_domains: Vec<String> = Vec::new();
    let mut had_proxy_rules = false;
    let mut had_direct_rules = false;
    let mut drained_legacy = false;

    for profile in &mut config.profiles {
        if !profile.pac_rules.is_empty()
            || !profile.bypass_list.is_empty()
            || !profile.removed_builtin_direct_domains.is_empty()
            || !profile.disabled_builtin_direct_domains.is_empty()
        {
            drained_legacy = true;
        }
        for rule in profile.pac_rules.drain(..) {
            let domain = normalize_domain_rule(&rule.domain);
            if domain.is_empty() {
                continue;
            }
            if rule.strategy == PacStrategy::Proxy {
                proxy_domains.push(domain.clone());
                if !rule.enabled {
                    disabled_proxy_domains.push(domain);
                }
                had_proxy_rules = true;
            } else {
                direct_domains.push(domain.clone());
                if !rule.enabled {
                    disabled_direct_domains.push(domain);
                }
                had_direct_rules = true;
            }
        }
        for item in profile.bypass_list.drain(..) {
            let item = item.trim().to_string();
            if !item.is_empty() {
                direct_domains.push(item);
                had_direct_rules = true;
            }
        }
        for domain in profile.removed_builtin_direct_domains.drain(..) {
            let normalized = normalize_domain_rule(&domain);
            if !normalized.is_empty() {
                removed_direct_domains.push(normalized);
            }
        }
        for domain in profile.disabled_builtin_direct_domains.drain(..) {
            let normalized = normalize_domain_rule(&domain);
            if !normalized.is_empty() {
                disabled_direct_domains.push(normalized);
            }
        }
    }

    let mut changed = false;
    for domain in proxy_domains {
        if !config
            .unified_lists
            .proxy_domains
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&domain))
        {
            config.unified_lists.proxy_domains.push(domain);
            changed = true;
        }
    }
    for domain in direct_domains {
        if !config
            .unified_lists
            .direct_domains
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&domain))
        {
            config.unified_lists.direct_domains.push(domain);
            changed = true;
        }
    }

    for domain in disabled_proxy_domains {
        if !rule_list_contains(&config.unified_lists.disabled_proxy_domains, &domain) {
            config.unified_lists.disabled_proxy_domains.push(domain);
            changed = true;
        }
    }
    for domain in disabled_direct_domains {
        if !rule_list_contains(&config.unified_lists.disabled_direct_domains, &domain) {
            config.unified_lists.disabled_direct_domains.push(domain);
            changed = true;
        }
    }

    // 旧版配置：把常用国内直连域名并入直连名单（减去已删除的；停用状态单独保留）。
    if drained_legacy {
        for domain in default_chinese_direct_domains() {
            let normalized = normalize_domain_rule(&domain);
            let removed = removed_direct_domains
                .iter()
                .any(|item| item == &normalized);
            if !removed
                && !config
                    .unified_lists
                    .direct_domains
                    .iter()
                    .any(|item| item.eq_ignore_ascii_case(&domain))
            {
                config.unified_lists.direct_domains.push(domain);
                changed = true;
            }
        }
    }

    // 被删除的内置直连：确保不在直连名单和停用状态里。
    for removed in removed_direct_domains {
        if let Some(index) = config
            .unified_lists
            .direct_domains
            .iter()
            .position(|item| normalize_domain_rule(item) == removed)
        {
            config.unified_lists.direct_domains.remove(index);
            changed = true;
        }
        let before_disabled = config.unified_lists.disabled_direct_domains.len();
        config
            .unified_lists
            .disabled_direct_domains
            .retain(|item| normalize_domain_rule(item) != removed);
        changed |= before_disabled != config.unified_lists.disabled_direct_domains.len();
    }

    if had_proxy_rules && !config.unified_lists.proxy_enabled {
        config.unified_lists.proxy_enabled = true;
        changed = true;
    }
    if had_direct_rules && !config.unified_lists.direct_enabled {
        config.unified_lists.direct_enabled = true;
        changed = true;
    }

    changed || drained_legacy
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
    let original_host = profile.host.clone();
    profile.host = profile.host.trim().to_string();
    profile.host != original_host
}

fn validate_profile(profile: &ProxyProfile) -> Result<()> {
    let host = profile.host.trim();
    if host.is_empty() {
        bail!("代理地址不能为空");
    }
    if profile.port == 0 {
        bail!("代理端口必须在 1 到 65535 之间");
    }
    if host.contains("://")
        || host.chars().any(char::is_whitespace)
        || host.contains(['/', '\\', '@', '?', '#', ';', '='])
    {
        bail!("代理地址只需填写主机名或 IP，不要包含协议、路径或空白字符");
    }
    if host.contains(':') {
        let is_bracketed_ipv6 = host
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
            .and_then(|value| value.parse::<std::net::Ipv6Addr>().ok())
            .is_some();
        if !is_bracketed_ipv6 {
            bail!("IPv6 代理地址必须使用 [地址] 格式");
        }
    }
    Ok(())
}

fn is_retired_default_bypass_rule(rule: &str) -> bool {
    normalize_domain_rule(rule) == "looklookfactory.com"
}

/// 旧版本曾内置 `looklookfactory.com` 直连规则。只在读取无版本号的历史配置时
/// 清理一次；迁移完成后允许用户重新添加同名规则。
fn migrate_config_schema(config: &mut AppConfig) -> bool {
    if config.schema_version >= CURRENT_CONFIG_SCHEMA_VERSION {
        return false;
    }

    config
        .unified_lists
        .direct_domains
        .retain(|rule| !is_retired_default_bypass_rule(rule));
    config
        .unified_lists
        .disabled_direct_domains
        .retain(|rule| !is_retired_default_bypass_rule(rule));
    config.schema_version = CURRENT_CONFIG_SCHEMA_VERSION;
    true
}

/// 归一化统一名单：去空、去重。按规则类型分别处理：
/// - Domain：归一化（去除 `*.` / `.` 前缀，转小写）
/// - Cidr / Glob：仅 trim + 转小写，保留原始语法
/// 返回是否有变化。
fn sanitize_unified_lists(lists: &mut UnifiedLists) -> bool {
    let before = lists.clone();

    lists.direct_domains = dedupe_unified_rules(&lists.direct_domains);
    lists.proxy_domains = dedupe_unified_rules(&lists.proxy_domains);
    lists.disabled_direct_domains = dedupe_unified_rules(&lists.disabled_direct_domains)
        .into_iter()
        .filter(|rule| rule_list_contains(&lists.direct_domains, rule))
        .collect();
    lists.disabled_proxy_domains = dedupe_unified_rules(&lists.disabled_proxy_domains)
        .into_iter()
        .filter(|rule| rule_list_contains(&lists.proxy_domains, rule))
        .collect();

    before != *lists
}

fn dedupe_unified_rules(rules: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();
    for rule in rules {
        let trimmed = rule.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("::1") {
            continue;
        }
        let key = unified_rule_key(trimmed);
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        result.push(trimmed.to_string());
    }
    result
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
        backup_path, convert_legacy, migrate_config_schema, migrate_profile_rules_to_unified,
        migrate_project_named_config_dir_from, parse_legacy_bypass, read_config_with_recovery,
        sanitize_unified_lists, save_config_atomically, AppConfig, ConfigStore, LegacyConfig,
        CURRENT_CONFIG_SCHEMA_VERSION,
    };
    use crate::models::{default_profile, PacRule, PacStrategy, ProxyMode, UnifiedLists};
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
        assert_eq!(config.unified_lists.proxy_domains, vec!["google.com"]);
        assert!(config.unified_lists.proxy_enabled);
    }

    #[test]
    fn migrates_legacy_profile_rules_into_unified_lists_and_clears_legacy_fields() {
        let mut config = AppConfig::default();
        config.unified_lists = UnifiedLists {
            direct_enabled: false,
            direct_domains: vec![],
            disabled_direct_domains: vec![],
            proxy_enabled: false,
            proxy_domains: vec![],
            disabled_proxy_domains: vec![],
        };
        config.profiles[0].pac_rules = vec![
            PacRule {
                id: "google.com".into(),
                domain: "*.google.com".into(),
                strategy: PacStrategy::Proxy,
                enabled: true,
                note: None,
            },
            PacRule {
                id: "example.test".into(),
                domain: "example.test".into(),
                strategy: PacStrategy::Direct,
                enabled: true,
                note: None,
            },
            PacRule {
                id: "disabled.test".into(),
                domain: "disabled.test".into(),
                strategy: PacStrategy::Proxy,
                enabled: false,
                note: None,
            },
        ];
        config.profiles[0].bypass_list = vec!["10.*".into(), "127.0.0.1".into()];
        config.profiles[0].removed_builtin_direct_domains = vec!["*.baidu.com".into()];
        config.profiles[0].disabled_builtin_direct_domains = vec!["qq.com".into()];

        assert!(migrate_profile_rules_to_unified(&mut config));

        assert!(config.unified_lists.proxy_enabled);
        assert!(config.unified_lists.direct_enabled);
        assert!(config
            .unified_lists
            .proxy_domains
            .iter()
            .any(|d| d == "google.com"));
        assert!(config
            .unified_lists
            .proxy_domains
            .iter()
            .any(|d| d == "disabled.test"));
        assert!(config
            .unified_lists
            .disabled_proxy_domains
            .iter()
            .any(|d| d == "disabled.test"));
        assert!(config
            .unified_lists
            .direct_domains
            .iter()
            .any(|d| d == "example.test"));
        assert!(config
            .unified_lists
            .direct_domains
            .iter()
            .any(|d| d == "10.*"));
        // 旧版配置会并入国内直连默认值，但被删除的内置直连（baidu.com）除外。
        assert!(config
            .unified_lists
            .direct_domains
            .iter()
            .any(|d| d == "qq.com"));
        assert!(config
            .unified_lists
            .disabled_direct_domains
            .iter()
            .any(|d| d == "qq.com"));
        assert!(!config
            .unified_lists
            .direct_domains
            .iter()
            .any(|d| d == "baidu.com"));
        assert!(config.profiles[0].pac_rules.is_empty());
        assert!(config.profiles[0].bypass_list.is_empty());
        assert!(config.profiles[0].removed_builtin_direct_domains.is_empty());
        assert!(config.profiles[0]
            .disabled_builtin_direct_domains
            .is_empty());
    }

    #[test]
    fn removes_windows_unsupported_ipv6_bypass_item_from_unified_list() {
        let mut unified = UnifiedLists::default();
        unified.direct_domains.push("::1".to_string());

        assert!(sanitize_unified_lists(&mut unified));
        assert!(!unified.direct_domains.contains(&"::1".to_string()));
    }

    #[test]
    fn removes_retired_default_bypass_domain_during_schema_migration() {
        let mut config = AppConfig::default();
        config.schema_version = 0;
        config
            .unified_lists
            .direct_domains
            .push("*.LOOKLOOKFACTORY.COM".to_string());
        assert!(migrate_config_schema(&mut config));
        assert_eq!(config.schema_version, CURRENT_CONFIG_SCHEMA_VERSION);
        assert!(!config
            .unified_lists
            .direct_domains
            .iter()
            .any(|item| item.to_ascii_lowercase().contains("looklookfactory.com")));
    }

    #[test]
    fn preserves_user_added_retired_default_bypass_domain_after_migration() {
        let mut config = AppConfig::default();
        config
            .unified_lists
            .direct_domains
            .push("*.looklookfactory.com".to_string());

        assert!(!migrate_config_schema(&mut config));
        let sanitized = ConfigStore::prepare_unified_lists(config.unified_lists);
        assert!(sanitized
            .direct_domains
            .iter()
            .any(|item| item == "*.looklookfactory.com"));
    }

    #[test]
    fn first_run_profile_is_prefilled_but_disabled() {
        let profile = default_profile();
        assert_eq!(profile.host, "192.168.0.6");
        assert_eq!(profile.port, 10808);
        assert_eq!(profile.mode, ProxyMode::Off);
    }

    #[test]
    fn validates_and_normalizes_proxy_address() {
        let mut profile = default_profile();
        profile.host = " 127.0.0.1 ".into();
        assert_eq!(
            ConfigStore::prepare_profile(profile)
                .expect("合法地址应通过校验")
                .host,
            "127.0.0.1"
        );

        let mut profile = default_profile();
        profile.host = "https://127.0.0.1/path".into();
        assert!(ConfigStore::prepare_profile(profile).is_err());

        let mut profile = default_profile();
        profile.port = 0;
        assert!(ConfigStore::prepare_profile(profile).is_err());

        for invalid_host in ["http=127.0.0.1", "127.0.0.1;https=proxy.example"] {
            let mut profile = default_profile();
            profile.host = invalid_host.into();
            assert!(ConfigStore::prepare_profile(profile).is_err());
        }
    }

    #[test]
    fn saves_profile_and_unified_lists_as_one_configuration() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("系统时间应晚于 Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "haruha-save-configuration-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("应创建测试目录");
        let path = directory.join("config.json");
        let mut store = ConfigStore {
            path: path.clone(),
            config: AppConfig::default(),
        };
        let mut profile = default_profile();
        profile.host = "198.51.100.20".into();
        profile.port = 3128;
        let mut lists = UnifiedLists::default();
        lists.proxy_enabled = true;
        lists.proxy_domains = vec![" example.com ".into(), "EXAMPLE.com".into()];

        let (saved_profile, saved_lists) = store
            .save_configuration(profile, lists)
            .expect("配置应整体保存成功");
        let persisted: AppConfig =
            serde_json::from_str(&fs::read_to_string(&path).expect("应读取保存后的配置"))
                .expect("保存后的配置应可解析");

        assert_eq!(saved_profile.host, "198.51.100.20");
        assert_eq!(saved_lists.proxy_domains, vec!["example.com"]);
        assert_eq!(persisted.profiles[0], saved_profile);
        assert_eq!(persisted.unified_lists, saved_lists);
        fs::remove_dir_all(directory).expect("应清理测试目录");
    }

    #[test]
    fn restores_in_memory_configuration_when_combined_save_fails() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("系统时间应晚于 Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "haruha-save-configuration-failure-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("应创建测试目录");
        let original = AppConfig::default();
        let mut store = ConfigStore {
            path: directory.clone(),
            config: original.clone(),
        };
        let mut profile = default_profile();
        profile.host = "203.0.113.30".into();
        let mut lists = UnifiedLists::default();
        lists.direct_enabled = true;
        lists.direct_domains = vec!["example.test".into()];

        assert!(store.save_configuration(profile, lists).is_err());
        assert_eq!(
            serde_json::to_value(&store.config).expect("当前内存配置应可序列化"),
            serde_json::to_value(&original).expect("原配置应可序列化")
        );
        fs::remove_dir_all(directory).expect("应清理测试目录");
    }

    #[test]
    fn restores_corrupted_config_from_last_valid_backup() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("系统时间应晚于 Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "haruha-config-recovery-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("应创建测试目录");
        let path = directory.join("config.json");

        let first = AppConfig::default();
        save_config_atomically(
            &path,
            &serde_json::to_vec_pretty(&first).expect("应序列化初始配置"),
        )
        .expect("应写入初始配置");

        let mut second = first.clone();
        second.profiles[0].host = "198.51.100.10".into();
        save_config_atomically(
            &path,
            &serde_json::to_vec_pretty(&second).expect("应序列化新配置"),
        )
        .expect("应原子替换配置");
        assert!(backup_path(&path).exists());

        fs::write(&path, "{broken").expect("应写入损坏配置用于测试");
        let recovered = read_config_with_recovery(&path).expect("应从备份恢复配置");
        assert_eq!(recovered.profiles[0].host, first.profiles[0].host);
        assert!(serde_json::from_str::<AppConfig>(
            &fs::read_to_string(&path).expect("应读取恢复后的配置")
        )
        .is_ok());

        fs::remove_dir_all(directory).expect("应清理测试目录");
    }

    #[test]
    fn quarantines_corrupted_config_when_no_backup_exists() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("系统时间应晚于 Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "haruha-config-quarantine-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("应创建测试目录");
        let path = directory.join("config.json");
        fs::write(&path, "{broken-without-backup").expect("应写入损坏配置用于测试");

        let recovered = read_config_with_recovery(&path).expect("应重建默认配置");
        assert_eq!(recovered.profiles[0].mode, ProxyMode::Off);
        assert!(fs::read_dir(&directory)
            .expect("应读取测试目录")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));

        fs::remove_dir_all(directory).expect("应清理测试目录");
    }
}

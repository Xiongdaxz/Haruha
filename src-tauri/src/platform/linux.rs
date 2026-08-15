use anyhow::{Context, Result};

use crate::models::{PlatformCapabilities, ProxyMode, ProxyProfile, ProxyState, UnifiedLists};

pub fn capabilities() -> PlatformCapabilities {
    let desktop = current_desktop();
    let supported = is_gnome_like(&desktop);
    PlatformCapabilities {
        manual_proxy: supported,
        pac_proxy: supported,
        tray: false,
        global_shortcut: false,
        auto_start: false,
        requires_elevated_permission: false,
        details: vec![if is_kde_like(&desktop) {
            "已检测到 KDE，系统代理写入尚未适配 kwriteconfig5/6".to_string()
        } else {
            format!(
                "桌面环境: {}",
                desktop.unwrap_or_else(|| "未知".to_string())
            )
        }],
    }
}

pub fn read_state() -> ProxyState {
    let capabilities = capabilities();
    let desktop = current_desktop();

    if is_gnome_like(&desktop) {
        match gsettings_output(&["get", "org.gnome.system.proxy", "mode"]) {
            Ok(mode) if clean_gsettings_value(&mode) == "manual" => {
                let host = gsettings_output(&["get", "org.gnome.system.proxy.http", "host"])
                    .map(|value| clean_gsettings_value(&value))
                    .ok();
                let port = gsettings_output(&["get", "org.gnome.system.proxy.http", "port"])
                    .map(|value| clean_gsettings_value(&value))
                    .ok();
                return ProxyState {
                    mode: ProxyMode::Manual,
                    address: match (host, port) {
                        (Some(host), Some(port)) if !host.is_empty() && !port.is_empty() => {
                            Some(format!("{host}:{port}"))
                        }
                        _ => None,
                    },
                    pac_url: None,
                    platform: super::platform_name(),
                    capabilities,
                    last_error: None,
                };
            }
            Ok(mode) if clean_gsettings_value(&mode) == "auto" => {
                let pac_url =
                    gsettings_output(&["get", "org.gnome.system.proxy", "autoconfig-url"])
                        .map(|value| clean_gsettings_value(&value))
                        .ok();
                return ProxyState {
                    mode: ProxyMode::Pac,
                    address: None,
                    pac_url,
                    platform: super::platform_name(),
                    capabilities,
                    last_error: None,
                };
            }
            Ok(_) => {
                return ProxyState {
                    mode: ProxyMode::Off,
                    address: None,
                    pac_url: None,
                    platform: super::platform_name(),
                    capabilities,
                    last_error: None,
                };
            }
            Err(error) => {
                return ProxyState {
                    mode: ProxyMode::Off,
                    address: None,
                    pac_url: None,
                    platform: super::platform_name(),
                    capabilities,
                    last_error: Some(format!("读取GNOME代理状态失败: {error}")),
                };
            }
        }
    }

    ProxyState {
        mode: ProxyMode::Off,
        address: None,
        pac_url: None,
        platform: super::platform_name(),
        last_error: if capabilities.manual_proxy {
            Some("当前Linux桌面环境已识别，但状态读取需要专门适配".to_string())
        } else {
            Some("当前Linux桌面环境暂不支持自动写入系统代理".to_string())
        },
        capabilities,
    }
}

pub fn enable_manual(profile: &ProxyProfile, unified: &UnifiedLists) -> Result<()> {
    let desktop = current_desktop();
    if is_gnome_like(&desktop) {
        gsettings(&["set", "org.gnome.system.proxy", "mode", "manual"])?;
        gsettings(&["set", "org.gnome.system.proxy.http", "host", &profile.host])?;
        gsettings(&[
            "set",
            "org.gnome.system.proxy.http",
            "port",
            &profile.port.to_string(),
        ])?;
        gsettings(&["set", "org.gnome.system.proxy.https", "host", &profile.host])?;
        gsettings(&[
            "set",
            "org.gnome.system.proxy.https",
            "port",
            &profile.port.to_string(),
        ])?;
        let mut ignore_hosts = Vec::new();
        if unified.direct_enabled {
            for domain in &unified.direct_domains {
                if unified.is_direct_rule_disabled(domain) {
                    continue;
                }
                if !crate::models::rule_works_in_manual(domain) {
                    continue;
                }
                if !ignore_hosts.iter().any(|item| item == domain) {
                    ignore_hosts.push(domain.clone());
                }
            }
        }
        if profile.bypass_local {
            for domain in ["localhost", "127.0.0.1"] {
                if !ignore_hosts.iter().any(|item| item == domain) {
                    ignore_hosts.push(domain.to_string());
                }
            }
        }
        gsettings(&[
            "set",
            "org.gnome.system.proxy",
            "ignore-hosts",
            &format_gsettings_list(&ignore_hosts),
        ])?;
        return Ok(());
    }

    if is_kde_like(&desktop) {
        return kde_not_ready();
    }

    anyhow::bail!("当前Linux桌面环境暂不支持自动写入系统代理")
}

pub fn enable_pac(pac_url: &str) -> Result<()> {
    let desktop = current_desktop();
    if is_gnome_like(&desktop) {
        gsettings(&["set", "org.gnome.system.proxy", "mode", "auto"])?;
        gsettings(&["set", "org.gnome.system.proxy", "autoconfig-url", pac_url])?;
        return Ok(());
    }

    if is_kde_like(&desktop) {
        return kde_not_ready();
    }

    anyhow::bail!("当前Linux桌面环境暂不支持PAC代理")
}

pub fn disable_proxy() -> Result<()> {
    let desktop = current_desktop();
    if is_gnome_like(&desktop) {
        gsettings(&["set", "org.gnome.system.proxy", "mode", "none"])?;
        return Ok(());
    }

    if is_kde_like(&desktop) {
        return kde_not_ready();
    }

    anyhow::bail!("当前Linux桌面环境暂不支持关闭系统代理")
}

fn current_desktop() -> Option<String> {
    std::env::var("XDG_CURRENT_DESKTOP")
        .ok()
        .or_else(|| std::env::var("DESKTOP_SESSION").ok())
}

fn is_gnome_like(desktop: &Option<String>) -> bool {
    desktop
        .as_deref()
        .map(|value| {
            let value = value.to_ascii_lowercase();
            value.contains("gnome") || value.contains("unity") || value.contains("cinnamon")
        })
        .unwrap_or(false)
}

fn is_kde_like(desktop: &Option<String>) -> bool {
    desktop
        .as_deref()
        .map(|value| value.to_ascii_lowercase().contains("kde"))
        .unwrap_or(false)
}

fn gsettings(args: &[&str]) -> Result<()> {
    let status = std::process::Command::new("gsettings")
        .args(args)
        .status()
        .context("调用 gsettings 失败")?;
    if !status.success() {
        anyhow::bail!("gsettings {:?} 执行失败", args);
    }
    Ok(())
}

fn gsettings_output(args: &[&str]) -> Result<String> {
    let output = std::process::Command::new("gsettings")
        .args(args)
        .output()
        .context("调用 gsettings 失败")?;
    if !output.status.success() {
        anyhow::bail!("gsettings {:?} 执行失败", args);
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn clean_gsettings_value(value: &str) -> String {
    value
        .trim()
        .trim_matches('\'')
        .trim_matches('"')
        .to_string()
}

fn format_gsettings_list(items: &[String]) -> String {
    let escaped = items
        .iter()
        .map(|item| format!("'{}'", item.replace('\'', "\\'")))
        .collect::<Vec<_>>()
        .join(", ");
    format!("[{escaped}]")
}

fn kde_not_ready<T>() -> Result<T> {
    anyhow::bail!("已检测到KDE环境，但KDE代理写入需要在后续适配kwriteconfig5/6后启用")
}

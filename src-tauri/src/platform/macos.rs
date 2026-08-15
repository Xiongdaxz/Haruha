use anyhow::{Context, Result};

use crate::models::{PlatformCapabilities, ProxyMode, ProxyProfile, ProxyState, UnifiedLists};

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        manual_proxy: true,
        pac_proxy: true,
        tray: false,
        global_shortcut: false,
        auto_start: false,
        requires_elevated_permission: false,
        details: vec![
            "networksetup 网络服务代理设置".to_string(),
            "当前版本未启用系统托盘和全局快捷键".to_string(),
        ],
    }
}

pub fn read_state() -> ProxyState {
    let capabilities = capabilities();
    let services = match network_services() {
        Ok(services) => services,
        Err(error) => {
            return ProxyState {
                mode: ProxyMode::Off,
                address: None,
                pac_url: None,
                platform: super::platform_name(),
                capabilities,
                last_error: Some(format!("读取macOS网络服务失败: {error}")),
            };
        }
    };

    for service in services {
        if let Ok(output) = networksetup_output(&["-getautoproxyurl", &service]) {
            if is_enabled(&output) {
                return ProxyState {
                    mode: ProxyMode::Pac,
                    address: None,
                    pac_url: value_after(&output, "URL:"),
                    platform: super::platform_name(),
                    capabilities,
                    last_error: None,
                };
            }
        }

        if let Ok(output) = networksetup_output(&["-getwebproxy", &service]) {
            if is_enabled(&output) {
                let server = value_after(&output, "Server:");
                let port = value_after(&output, "Port:");
                return ProxyState {
                    mode: ProxyMode::Manual,
                    address: match (server, port) {
                        (Some(server), Some(port)) => Some(format!("{server}:{port}")),
                        _ => None,
                    },
                    pac_url: None,
                    platform: super::platform_name(),
                    capabilities,
                    last_error: None,
                };
            }
        }
    }

    ProxyState {
        mode: ProxyMode::Off,
        address: None,
        pac_url: None,
        platform: super::platform_name(),
        capabilities,
        last_error: None,
    }
}

pub fn enable_manual(profile: &ProxyProfile, unified: &UnifiedLists) -> Result<()> {
    let mut bypass_domains = Vec::new();
    if unified.direct_enabled {
        for domain in &unified.direct_domains {
            if unified.is_direct_rule_disabled(domain) {
                continue;
            }
            if !crate::models::rule_works_in_manual(domain) {
                continue;
            }
            if !bypass_domains.iter().any(|item| item == domain) {
                bypass_domains.push(domain.clone());
            }
        }
    }
    if profile.bypass_local {
        for domain in ["localhost", "127.0.0.1"] {
            if !bypass_domains.iter().any(|item| item == domain) {
                bypass_domains.push(domain.to_string());
            }
        }
    }
    let bypass_args: Vec<String> = bypass_domains
        .iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty() && item != "::1")
        .collect();

    for service in network_services()? {
        run_networksetup(&[
            "-setwebproxy",
            &service,
            &profile.host,
            &profile.port.to_string(),
        ])?;
        run_networksetup(&[
            "-setsecurewebproxy",
            &service,
            &profile.host,
            &profile.port.to_string(),
        ])?;
        {
            let mut args = vec!["-setproxybypassdomains".to_string(), service.clone()];
            if bypass_args.is_empty() {
                args.push("Empty".to_string());
            }
            args.extend(bypass_args.iter().cloned());
            let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            run_networksetup(&args_ref)?;
        }
        run_networksetup(&["-setwebproxystate", &service, "on"])?;
        run_networksetup(&["-setsecurewebproxystate", &service, "on"])?;
        run_networksetup(&["-setautoproxystate", &service, "off"])?;
    }
    Ok(())
}

pub fn enable_pac(pac_url: &str) -> Result<()> {
    for service in network_services()? {
        run_networksetup(&["-setautoproxyurl", &service, pac_url])?;
        run_networksetup(&["-setautoproxystate", &service, "on"])?;
        run_networksetup(&["-setwebproxystate", &service, "off"])?;
        run_networksetup(&["-setsecurewebproxystate", &service, "off"])?;
    }
    Ok(())
}

pub fn disable_proxy() -> Result<()> {
    for service in network_services()? {
        run_networksetup(&["-setwebproxystate", &service, "off"])?;
        run_networksetup(&["-setsecurewebproxystate", &service, "off"])?;
        run_networksetup(&["-setautoproxystate", &service, "off"])?;
    }
    Ok(())
}

fn network_services() -> Result<Vec<String>> {
    let output = std::process::Command::new("networksetup")
        .arg("-listallnetworkservices")
        .output()
        .context("调用 networksetup 失败")?;
    if !output.status.success() {
        anyhow::bail!("读取macOS网络服务失败");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let services = stdout
        .lines()
        .filter(|line| !line.starts_with("An asterisk"))
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('*'))
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if services.is_empty() {
        anyhow::bail!("未找到可用的macOS网络服务");
    }
    Ok(services)
}

fn run_networksetup(args: &[&str]) -> Result<()> {
    let status = std::process::Command::new("networksetup")
        .args(args)
        .status()?;
    if !status.success() {
        anyhow::bail!("networksetup {:?} 执行失败", args);
    }
    Ok(())
}

fn networksetup_output(args: &[&str]) -> Result<String> {
    let output = std::process::Command::new("networksetup")
        .args(args)
        .output()?;
    if !output.status.success() {
        anyhow::bail!("networksetup {:?} 执行失败", args);
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn is_enabled(output: &str) -> bool {
    output
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case("Enabled: Yes"))
}

fn value_after(output: &str, prefix: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let line = line.trim();
        line.strip_prefix(prefix)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

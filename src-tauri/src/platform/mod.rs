#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

#[cfg(windows)]
pub use windows::SystemProxySnapshot;

use anyhow::Result;

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
use crate::models::PlatformCapabilities;
use crate::models::{ProxyProfile, ProxyState, UnifiedLists};

pub fn read_state() -> ProxyState {
    #[cfg(windows)]
    {
        windows::read_state()
    }
    #[cfg(target_os = "macos")]
    {
        macos::read_state()
    }
    #[cfg(target_os = "linux")]
    {
        linux::read_state()
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        ProxyState {
            mode: crate::models::ProxyMode::Off,
            address: None,
            pac_url: None,
            platform: platform_name(),
            capabilities: unsupported_capabilities(),
            last_error: Some("当前平台暂不支持系统代理写入".to_string()),
        }
    }
}

pub fn enable_manual(profile: &ProxyProfile, unified: &UnifiedLists) -> Result<()> {
    #[cfg(windows)]
    {
        windows::enable_manual(profile, unified)
    }
    #[cfg(target_os = "macos")]
    {
        macos::enable_manual(profile, unified)
    }
    #[cfg(target_os = "linux")]
    {
        linux::enable_manual(profile, unified)
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        anyhow::bail!("当前平台暂不支持手动代理")
    }
}

pub fn enable_pac(pac_url: &str) -> Result<()> {
    #[cfg(windows)]
    {
        windows::enable_pac(pac_url)
    }
    #[cfg(target_os = "macos")]
    {
        macos::enable_pac(pac_url)
    }
    #[cfg(target_os = "linux")]
    {
        linux::enable_pac(pac_url)
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        anyhow::bail!("当前平台暂不支持PAC代理")
    }
}

pub fn disable_proxy() -> Result<()> {
    #[cfg(windows)]
    {
        windows::disable_proxy()
    }
    #[cfg(target_os = "macos")]
    {
        macos::disable_proxy()
    }
    #[cfg(target_os = "linux")]
    {
        linux::disable_proxy()
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        anyhow::bail!("当前平台暂不支持关闭系统代理")
    }
}

#[cfg(windows)]
pub fn capture_system_proxy_snapshot() -> Result<SystemProxySnapshot> {
    windows::capture_system_proxy_snapshot()
}

#[cfg(windows)]
pub fn restore_system_proxy_snapshot(snapshot: &SystemProxySnapshot) -> Result<()> {
    windows::restore_system_proxy_snapshot(snapshot)
}

pub fn network_traffic_totals() -> Result<(u64, u64)> {
    #[cfg(windows)]
    {
        return windows::network_traffic_totals();
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("当前平台暂不支持实时流量统计")
    }
}

pub fn platform_name() -> String {
    format!("{} / {}", std::env::consts::OS, std::env::consts::ARCH)
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub fn unsupported_capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        manual_proxy: false,
        pac_proxy: false,
        tray: false,
        global_shortcut: false,
        auto_start: false,
        requires_elevated_permission: false,
        details: vec!["当前平台暂不支持系统代理写入".to_string()],
    }
}

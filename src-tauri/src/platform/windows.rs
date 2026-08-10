#[cfg(windows)]
use anyhow::{bail, Result};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{GetLastError, NO_ERROR};
#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetIfTable2, IF_TYPE_SOFTWARE_LOOPBACK, MIB_IF_TABLE2,
};
#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
#[cfg(windows)]
use windows_sys::Win32::Networking::WinInet::{
    InternetSetOptionW, INTERNET_OPTION_PER_CONNECTION_OPTION, INTERNET_OPTION_REFRESH,
    INTERNET_OPTION_SETTINGS_CHANGED, INTERNET_PER_CONN_AUTOCONFIG_URL, INTERNET_PER_CONN_FLAGS,
    INTERNET_PER_CONN_OPTIONW, INTERNET_PER_CONN_OPTIONW_0, INTERNET_PER_CONN_OPTION_LISTW,
    INTERNET_PER_CONN_PROXY_BYPASS, INTERNET_PER_CONN_PROXY_SERVER, PROXY_TYPE_AUTO_PROXY_URL,
    PROXY_TYPE_DIRECT, PROXY_TYPE_PROXY,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
};
#[cfg(windows)]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

use crate::models::{PlatformCapabilities, ProxyMode, ProxyProfile, ProxyState, UnifiedLists};

#[cfg(windows)]
const INTERNET_SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        manual_proxy: true,
        pac_proxy: true,
        tray: true,
        global_shortcut: false,
        auto_start: false,
        requires_elevated_permission: false,
        details: vec![
            "WinINet 当前用户代理设置".to_string(),
            "已启用系统托盘，暂未启用全局快捷键".to_string(),
        ],
    }
}

pub fn read_state() -> ProxyState {
    #[cfg(windows)]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let capabilities = capabilities();
        match hkcu.open_subkey(INTERNET_SETTINGS) {
            Ok(key) => {
                if let Ok(url) = key.get_value::<String, _>("AutoConfigURL") {
                    if !url.trim().is_empty() {
                        return ProxyState {
                            mode: ProxyMode::Pac,
                            address: None,
                            pac_url: Some(url),
                            platform: super::platform_name(),
                            capabilities,
                            last_error: None,
                        };
                    }
                }

                let enabled = key.get_value::<u32, _>("ProxyEnable").unwrap_or(0);
                if enabled == 1 {
                    let address = key.get_value::<String, _>("ProxyServer").ok();
                    return ProxyState {
                        mode: ProxyMode::Manual,
                        address,
                        pac_url: None,
                        platform: super::platform_name(),
                        capabilities,
                        last_error: None,
                    };
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
            Err(error) => ProxyState {
                mode: ProxyMode::Off,
                address: None,
                pac_url: None,
                platform: super::platform_name(),
                capabilities,
                last_error: Some(format!("读取Windows代理状态失败: {error}")),
            },
        }
    }
    #[cfg(not(windows))]
    {
        ProxyState {
            mode: ProxyMode::Off,
            address: None,
            pac_url: None,
            platform: super::platform_name(),
            capabilities: capabilities(),
            last_error: Some("非Windows平台".to_string()),
        }
    }
}

#[cfg(windows)]
pub fn enable_manual(profile: &ProxyProfile, unified: &UnifiedLists) -> Result<()> {
    let proxy_server = profile.address();
    let proxy_bypass = proxy_override(profile, unified);
    set_wininet_connection_options(
        PROXY_TYPE_DIRECT | PROXY_TYPE_PROXY,
        Some(&proxy_server),
        Some(&proxy_bypass),
        None,
    )?;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(INTERNET_SETTINGS)?;
    key.set_value("MigrateProxy", &1u32)?;
    key.set_value("ProxyEnable", &1u32)?;
    key.set_value("AutoDetect", &0u32)?;
    key.set_value("ProxyServer", &proxy_server)?;
    key.set_value("ProxyOverride", &proxy_bypass)?;
    let _ = key.delete_value("AutoConfigURL");
    notify_proxy_changed();
    import_winhttp_from_wininet();
    Ok(())
}

#[cfg(windows)]
pub fn enable_pac(pac_url: &str) -> Result<()> {
    set_wininet_connection_options(
        PROXY_TYPE_DIRECT | PROXY_TYPE_AUTO_PROXY_URL,
        None,
        None,
        Some(pac_url),
    )?;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(INTERNET_SETTINGS)?;
    key.set_value("MigrateProxy", &1u32)?;
    key.set_value("ProxyEnable", &0u32)?;
    key.set_value("AutoDetect", &0u32)?;
    key.set_value("AutoConfigURL", &pac_url)?;
    let _ = key.delete_value("ProxyServer");
    notify_proxy_changed();
    import_winhttp_from_wininet();
    Ok(())
}

#[cfg(windows)]
pub fn disable_proxy() -> Result<()> {
    set_wininet_connection_options(PROXY_TYPE_DIRECT, None, None, None)?;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(INTERNET_SETTINGS)?;
    key.set_value("MigrateProxy", &1u32)?;
    key.set_value("ProxyEnable", &0u32)?;
    let _ = key.delete_value("AutoConfigURL");
    notify_proxy_changed();
    reset_winhttp_proxy();
    Ok(())
}

#[cfg(windows)]
pub fn network_traffic_totals() -> Result<(u64, u64)> {
    let mut table = std::ptr::null_mut::<MIB_IF_TABLE2>();
    let status = unsafe { GetIfTable2(&mut table) };
    if status != NO_ERROR {
        bail!("读取Windows网卡统计失败，错误码: {status}");
    }
    if table.is_null() {
        bail!("读取Windows网卡统计失败：返回了空表");
    }

    let totals = unsafe {
        let table_ref = &*table;
        let rows =
            std::slice::from_raw_parts(table_ref.Table.as_ptr(), table_ref.NumEntries as usize);
        let mut received_bytes = 0_u64;
        let mut sent_bytes = 0_u64;
        for row in rows {
            if row.Type == IF_TYPE_SOFTWARE_LOOPBACK || row.OperStatus != IfOperStatusUp {
                continue;
            }
            received_bytes = received_bytes.saturating_add(row.InOctets);
            sent_bytes = sent_bytes.saturating_add(row.OutOctets);
        }
        FreeMibTable(table.cast());
        (received_bytes, sent_bytes)
    };

    Ok(totals)
}

#[cfg(windows)]
fn proxy_override(profile: &ProxyProfile, unified: &UnifiedLists) -> String {
    let mut items = profile
        .bypass_list
        .iter()
        .filter_map(|item| windows_bypass_item(item))
        .collect::<Vec<_>>();
    if unified.direct_enabled {
        for domain in &unified.direct_domains {
            if !crate::models::rule_works_in_manual(domain) {
                continue;
            }
            if let Some(item) = windows_bypass_item(domain) {
                if !items.iter().any(|existing| existing == &item) {
                    items.push(item);
                }
            }
        }
    }
    if profile.bypass_local && !items.iter().any(|item| item == "<local>") {
        items.push("<local>".to_string());
    }
    items.join(";")
}

#[cfg(windows)]
fn windows_bypass_item(item: &str) -> Option<String> {
    let item = item.trim();
    if item.is_empty() || item.eq_ignore_ascii_case("::1") {
        return None;
    }
    Some(item.to_string())
}

#[cfg(windows)]
fn notify_proxy_changed() {
    spawn_hidden(
        "rundll32.exe",
        &["user32.dll,UpdatePerUserSystemParameters"],
    );
    unsafe {
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null_mut(),
            0,
        );
        InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null_mut(),
            0,
        );
        let setting = widestring("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings");
        let mut result = 0usize;
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            setting.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            1000,
            &mut result,
        );
    }
}

#[cfg(windows)]
fn widestring(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn set_wininet_connection_options(
    flags: u32,
    proxy_server: Option<&str>,
    bypass_list: Option<&str>,
    pac_url: Option<&str>,
) -> Result<()> {
    let mut strings = Vec::<Vec<u16>>::new();
    let mut options = vec![dword_connection_option(INTERNET_PER_CONN_FLAGS, flags)];

    if let Some(proxy_server) = proxy_server {
        let proxy_server_ptr = push_wide_option(&mut strings, proxy_server);
        options.push(string_connection_option(
            INTERNET_PER_CONN_PROXY_SERVER,
            proxy_server_ptr,
        ));
    }

    if let Some(bypass_list) = bypass_list {
        let bypass_list_ptr = push_wide_option(&mut strings, bypass_list);
        options.push(string_connection_option(
            INTERNET_PER_CONN_PROXY_BYPASS,
            bypass_list_ptr,
        ));
    }

    if let Some(pac_url) = pac_url {
        let pac_url_ptr = push_wide_option(&mut strings, pac_url);
        options.push(string_connection_option(
            INTERNET_PER_CONN_AUTOCONFIG_URL,
            pac_url_ptr,
        ));
    }

    let mut option_list = INTERNET_PER_CONN_OPTION_LISTW {
        dwSize: std::mem::size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32,
        pszConnection: std::ptr::null_mut(),
        dwOptionCount: options.len() as u32,
        dwOptionError: 0,
        pOptions: options.as_mut_ptr(),
    };

    let ok = unsafe {
        InternetSetOptionW(
            std::ptr::null(),
            INTERNET_OPTION_PER_CONNECTION_OPTION,
            &mut option_list as *mut _ as *const _,
            std::mem::size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32,
        )
    };
    if ok == 0 {
        let last_error = unsafe { GetLastError() };
        bail!(
            "设置Windows连接代理选项失败，失败项: {}, Windows错误码: {}",
            option_list.dwOptionError,
            last_error
        );
    }
    Ok(())
}

#[cfg(windows)]
fn dword_connection_option(option: u32, value: u32) -> INTERNET_PER_CONN_OPTIONW {
    INTERNET_PER_CONN_OPTIONW {
        dwOption: option,
        Value: INTERNET_PER_CONN_OPTIONW_0 { dwValue: value },
    }
}

#[cfg(windows)]
fn string_connection_option(option: u32, value: *mut u16) -> INTERNET_PER_CONN_OPTIONW {
    INTERNET_PER_CONN_OPTIONW {
        dwOption: option,
        Value: INTERNET_PER_CONN_OPTIONW_0 { pszValue: value },
    }
}

#[cfg(windows)]
fn push_wide_option(strings: &mut Vec<Vec<u16>>, value: &str) -> *mut u16 {
    strings.push(widestring(value));
    strings
        .last_mut()
        .map(|value| value.as_mut_ptr())
        .unwrap_or(std::ptr::null_mut())
}

#[cfg(windows)]
fn import_winhttp_from_wininet() {
    spawn_hidden("netsh", &["winhttp", "import", "proxy", "source=ie"]);
}

#[cfg(windows)]
fn reset_winhttp_proxy() {
    spawn_hidden("netsh", &["winhttp", "reset", "proxy"]);
}

#[cfg(windows)]
fn spawn_hidden(program: &str, args: &[&str]) {
    let _ = std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

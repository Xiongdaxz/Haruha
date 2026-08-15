#[cfg(windows)]
use anyhow::{bail, Context, Result};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{GetLastError, NO_ERROR};
#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetIfTable2, IF_TYPE_SOFTWARE_LOOPBACK, MIB_IF_ROW2, MIB_IF_TABLE2,
};
#[cfg(windows)]
use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
#[cfg(windows)]
use windows_sys::Win32::Networking::WinInet::{
    InternetQueryOptionW, InternetSetOptionW, INTERNET_OPTION_PER_CONNECTION_OPTION,
    INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED, INTERNET_PER_CONN_AUTOCONFIG_URL,
    INTERNET_PER_CONN_FLAGS, INTERNET_PER_CONN_OPTIONW, INTERNET_PER_CONN_OPTIONW_0,
    INTERNET_PER_CONN_OPTION_LISTW, INTERNET_PER_CONN_PROXY_BYPASS, INTERNET_PER_CONN_PROXY_SERVER,
    PROXY_TYPE_AUTO_DETECT, PROXY_TYPE_AUTO_PROXY_URL, PROXY_TYPE_DIRECT, PROXY_TYPE_PROXY,
};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
};
#[cfg(windows)]
use winreg::{enums::HKEY_CURRENT_USER, RegKey, RegValue};

use crate::models::{PlatformCapabilities, ProxyMode, ProxyProfile, ProxyState, UnifiedLists};

#[cfg(windows)]
const INTERNET_SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

#[cfg(windows)]
#[derive(Clone, Debug, PartialEq)]
struct RegistryValueSnapshot {
    bytes: Vec<u8>,
    value_type: winreg::enums::RegType,
}

#[cfg(windows)]
impl From<RegValue> for RegistryValueSnapshot {
    fn from(value: RegValue) -> Self {
        Self {
            bytes: value.bytes,
            value_type: value.vtype,
        }
    }
}

#[cfg(windows)]
#[derive(Clone, Debug, PartialEq)]
pub struct SystemProxySnapshot {
    connection_flags: u32,
    proxy_enable: Option<RegistryValueSnapshot>,
    proxy_server: Option<RegistryValueSnapshot>,
    proxy_override: Option<RegistryValueSnapshot>,
    auto_config_url: Option<RegistryValueSnapshot>,
    auto_detect: Option<RegistryValueSnapshot>,
    migrate_proxy: Option<RegistryValueSnapshot>,
    proxy_server_text: Option<String>,
    proxy_override_text: Option<String>,
    auto_config_url_text: Option<String>,
}

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
                let connection_flags = query_wininet_connection_flags().ok();
                let auto_config_url = key
                    .get_value::<String, _>("AutoConfigURL")
                    .ok()
                    .filter(|url| !url.trim().is_empty());
                let pac_enabled = connection_flags
                    .map(|flags| flags & PROXY_TYPE_AUTO_PROXY_URL != 0)
                    .unwrap_or(auto_config_url.is_some());
                if pac_enabled {
                    if let Some(url) = auto_config_url {
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
                let manual_enabled = connection_flags
                    .map(|flags| flags & PROXY_TYPE_PROXY != 0)
                    .unwrap_or(enabled == 1);
                if manual_enabled {
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
pub fn capture_system_proxy_snapshot() -> Result<SystemProxySnapshot> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(INTERNET_SETTINGS)
        .context("打开 Windows Internet Settings 注册表项失败")?;

    Ok(SystemProxySnapshot {
        connection_flags: query_wininet_connection_flags()?,
        proxy_enable: read_registry_value(&key, "ProxyEnable")?,
        proxy_server: read_registry_value(&key, "ProxyServer")?,
        proxy_override: read_registry_value(&key, "ProxyOverride")?,
        auto_config_url: read_registry_value(&key, "AutoConfigURL")?,
        auto_detect: read_registry_value(&key, "AutoDetect")?,
        migrate_proxy: read_registry_value(&key, "MigrateProxy")?,
        proxy_server_text: key.get_value("ProxyServer").ok(),
        proxy_override_text: key.get_value("ProxyOverride").ok(),
        auto_config_url_text: key.get_value("AutoConfigURL").ok(),
    })
}

#[cfg(windows)]
pub fn restore_system_proxy_snapshot(snapshot: &SystemProxySnapshot) -> Result<()> {
    let mut errors = Vec::new();
    if let Err(error) = set_wininet_connection_options(
        snapshot.connection_flags,
        snapshot.proxy_server_text.as_deref(),
        snapshot.proxy_override_text.as_deref(),
        snapshot.auto_config_url_text.as_deref(),
    ) {
        errors.push(error.to_string());
    }

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu
        .create_subkey(INTERNET_SETTINGS)
        .context("打开 Windows Internet Settings 注册表项失败")
    {
        Ok((key, _)) => {
            for (name, value) in [
                ("ProxyEnable", &snapshot.proxy_enable),
                ("ProxyServer", &snapshot.proxy_server),
                ("ProxyOverride", &snapshot.proxy_override),
                ("AutoConfigURL", &snapshot.auto_config_url),
                ("AutoDetect", &snapshot.auto_detect),
                ("MigrateProxy", &snapshot.migrate_proxy),
            ] {
                if let Err(error) = restore_registry_value(&key, name, value) {
                    errors.push(error.to_string());
                }
            }
        }
        Err(error) => errors.push(error.to_string()),
    }
    notify_proxy_changed();
    if errors.is_empty() {
        Ok(())
    } else {
        bail!(errors.join("；"))
    }
}

#[cfg(windows)]
fn read_registry_value(key: &RegKey, name: &str) -> Result<Option<RegistryValueSnapshot>> {
    match key.get_raw_value(name) {
        Ok(value) => Ok(Some(value.into())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("读取注册表值 {name} 失败")),
    }
}

#[cfg(windows)]
fn restore_registry_value(
    key: &RegKey,
    name: &str,
    value: &Option<RegistryValueSnapshot>,
) -> Result<()> {
    match value {
        Some(value) => key
            .set_raw_value(
                name,
                &RegValue {
                    bytes: value.bytes.clone(),
                    vtype: value.value_type.clone(),
                },
            )
            .with_context(|| format!("恢复注册表值 {name} 失败")),
        None => match key.delete_value(name) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error).with_context(|| format!("删除注册表值 {name} 失败")),
        },
    }
}

#[cfg(windows)]
fn query_wininet_connection_flags() -> Result<u32> {
    let mut option = dword_connection_option(INTERNET_PER_CONN_FLAGS, 0);
    let mut option_list = INTERNET_PER_CONN_OPTION_LISTW {
        dwSize: std::mem::size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32,
        pszConnection: std::ptr::null_mut(),
        dwOptionCount: 1,
        dwOptionError: 0,
        pOptions: &mut option,
    };
    let mut buffer_length = std::mem::size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32;
    let ok = unsafe {
        InternetQueryOptionW(
            std::ptr::null(),
            INTERNET_OPTION_PER_CONNECTION_OPTION,
            &mut option_list as *mut _ as *mut _,
            &mut buffer_length,
        )
    };
    if ok == 0 {
        bail!(
            "读取 Windows 连接代理标志失败，失败项: {}, Windows错误码: {}",
            option_list.dwOptionError,
            unsafe { GetLastError() }
        );
    }
    Ok(unsafe { option.Value.dwValue })
}

#[cfg(windows)]
pub fn enable_manual(profile: &ProxyProfile, unified: &UnifiedLists) -> Result<()> {
    let proxy_server = profile.address();
    let proxy_bypass = proxy_override(profile, unified);
    set_wininet_connection_options(
        connection_flags(true, false, false),
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
    Ok(())
}

#[cfg(windows)]
pub fn enable_pac(pac_url: &str) -> Result<()> {
    set_wininet_connection_options(
        connection_flags(false, true, false),
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
    Ok(())
}

#[cfg(windows)]
pub fn disable_proxy() -> Result<()> {
    set_wininet_connection_options(connection_flags(false, false, false), None, None, None)?;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(INTERNET_SETTINGS)?;
    key.set_value("MigrateProxy", &1u32)?;
    key.set_value("ProxyEnable", &0u32)?;
    let _ = key.delete_value("AutoConfigURL");
    notify_proxy_changed();
    Ok(())
}

#[cfg(windows)]
// windows-sys exposes MIB_IF_ROW2's HardwareInterface bit as the first raw flag.
const HARDWARE_INTERFACE_STATUS_FLAG: u8 = 0x01;

#[cfg(windows)]
fn should_count_network_interface(row: &MIB_IF_ROW2) -> bool {
    row.OperStatus == IfOperStatusUp
        && row.Type != IF_TYPE_SOFTWARE_LOOPBACK
        && row.InterfaceAndOperStatusFlags._bitfield & HARDWARE_INTERFACE_STATUS_FLAG != 0
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
            if !should_count_network_interface(row) {
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
    let mut items = Vec::new();
    if unified.direct_enabled {
        for domain in &unified.direct_domains {
            if unified.is_direct_rule_disabled(domain) {
                continue;
            }
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
    // WinINet 的 ProxyOverride 不接受以点开头的域名后缀（如 ".cn"），
    // 会让整次 InternetSetOptionW 失败（ERROR_INVALID_NAME / 错误码 123），
    // 导致手动代理无法应用。转换为通配符形式 "*.cn" 保留直连语义。
    if let Some(suffix) = item.strip_prefix('.') {
        if suffix.is_empty() || suffix.contains(['*', '?']) {
            return None;
        }
        return Some(format!("*.{suffix}"));
    }
    Some(item.to_string())
}

#[cfg(windows)]
fn connection_flags(manual_proxy: bool, pac_url: bool, auto_detect: bool) -> u32 {
    let mut flags = PROXY_TYPE_DIRECT;
    if manual_proxy {
        flags |= PROXY_TYPE_PROXY;
    }
    if pac_url {
        flags |= PROXY_TYPE_AUTO_PROXY_URL;
    }
    if auto_detect {
        flags |= PROXY_TYPE_AUTO_DETECT;
    }
    flags
}

#[cfg(windows)]
fn notify_proxy_changed() {
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

#[cfg(all(windows, test))]
mod tests {
    use super::{
        connection_flags, should_count_network_interface, windows_bypass_item,
        HARDWARE_INTERFACE_STATUS_FLAG,
    };
    use windows_sys::Win32::NetworkManagement::{
        IpHelper::{IF_TYPE_ETHERNET_CSMACD, IF_TYPE_SOFTWARE_LOOPBACK, MIB_IF_ROW2},
        Ndis::{IfOperStatusDown, IfOperStatusUp},
    };
    use windows_sys::Win32::Networking::WinInet::{
        PROXY_TYPE_AUTO_DETECT, PROXY_TYPE_AUTO_PROXY_URL, PROXY_TYPE_DIRECT, PROXY_TYPE_PROXY,
    };

    #[test]
    fn builds_connection_flags_without_touching_system_settings() {
        assert_eq!(connection_flags(false, false, false), PROXY_TYPE_DIRECT);
        assert_eq!(
            connection_flags(true, false, false),
            PROXY_TYPE_DIRECT | PROXY_TYPE_PROXY
        );
        assert_eq!(
            connection_flags(false, true, true),
            PROXY_TYPE_DIRECT | PROXY_TYPE_AUTO_PROXY_URL | PROXY_TYPE_AUTO_DETECT
        );
    }

    #[test]
    fn counts_only_active_physical_network_interfaces() {
        let mut ethernet = MIB_IF_ROW2 {
            Type: IF_TYPE_ETHERNET_CSMACD,
            OperStatus: IfOperStatusUp,
            ..MIB_IF_ROW2::default()
        };
        ethernet.InterfaceAndOperStatusFlags._bitfield = HARDWARE_INTERFACE_STATUS_FLAG;
        assert!(should_count_network_interface(&ethernet));

        let mut virtual_ethernet = ethernet;
        virtual_ethernet.InterfaceAndOperStatusFlags._bitfield = 0;
        assert!(!should_count_network_interface(&virtual_ethernet));

        let mut loopback = ethernet;
        loopback.Type = IF_TYPE_SOFTWARE_LOOPBACK;
        assert!(!should_count_network_interface(&loopback));

        let mut disconnected = ethernet;
        disconnected.OperStatus = IfOperStatusDown;
        assert!(!should_count_network_interface(&disconnected));
    }

    #[test]
    fn keeps_plain_domains_and_wildcards() {
        assert_eq!(
            windows_bypass_item("baidu.com"),
            Some("baidu.com".to_string())
        );
        assert_eq!(windows_bypass_item("10.*"), Some("10.*".to_string()));
        assert_eq!(
            windows_bypass_item("127.0.0.1"),
            Some("127.0.0.1".to_string())
        );
        assert_eq!(windows_bypass_item("<local>"), Some("<local>".to_string()));
    }

    #[test]
    fn converts_leading_dot_suffixes_to_wildcards() {
        assert_eq!(windows_bypass_item(".cn"), Some("*.cn".to_string()));
        assert_eq!(windows_bypass_item(".com.cn"), Some("*.com.cn".to_string()));
        assert_eq!(windows_bypass_item(".org.cn"), Some("*.org.cn".to_string()));
    }

    #[test]
    fn drops_empty_invalid_or_loopback_entries() {
        assert_eq!(windows_bypass_item(""), None);
        assert_eq!(windows_bypass_item("   "), None);
        assert_eq!(windows_bypass_item("::1"), None);
        assert_eq!(windows_bypass_item("."), None);
        assert_eq!(windows_bypass_item(".*"), None);
    }
}

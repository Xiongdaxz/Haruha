use std::{
    fs,
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use reqwest::header::CONTENT_TYPE;
use tauri::{
    image::Image,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

mod config;
mod models;
mod net;
mod pac;
mod pac_server;
mod platform;

use config::{append_app_log_line, write_pac_file, ConfigStore};
use models::{
    IpInfo, NetworkTrafficSample, ProxyMode, ProxyProfile, ProxyState, SpeedTestConfig,
    SpeedTestResult, TestResult, UnifiedLists,
};
use pac_server::PacServer;

const FAVICON_CACHE_HEADER: &[u8] = b"haruha-favicon-v2\n";

struct AppState {
    store: Mutex<ConfigStore>,
    pac_server: Mutex<PacServer>,
    is_exiting: Mutex<bool>,
}

#[tauri::command]
fn get_proxy_state(state: tauri::State<'_, AppState>) -> ProxyState {
    logical_current_proxy_state(&state)
}

#[tauri::command]
fn append_app_log(level: String, message: String, timestamp: String) -> Result<(), String> {
    append_app_log_line(&level, &message, &timestamp).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_active_profile(state: tauri::State<'_, AppState>) -> Result<ProxyProfile, String> {
    let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
    Ok(store.active_profile())
}

#[tauri::command]
fn save_profile(
    profile: ProxyProfile,
    state: tauri::State<'_, AppState>,
) -> Result<ProxyProfile, String> {
    let mut store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
    store
        .save_profile(profile)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_unified_lists(state: tauri::State<'_, AppState>) -> Result<UnifiedLists, String> {
    let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
    Ok(store.unified_lists().clone())
}

#[tauri::command]
async fn save_unified_lists(
    app: AppHandle,
    lists: UnifiedLists,
    state: tauri::State<'_, AppState>,
) -> Result<UnifiedLists, String> {
    let saved = {
        let mut store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        store
            .set_unified_lists(lists)
            .map_err(|error| error.to_string())?
    };

    // 名单变更后，若当前处于 Manual/Pac 模式，需重新应用以让名单即时生效
    let profile = {
        let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        store.active_profile()
    };
    match profile.mode {
        ProxyMode::Manual => {
            let proxy_state = apply_manual_profile(profile, &state).await?;
            broadcast_proxy_state(&app, &proxy_state);
        }
        ProxyMode::Pac => {
            let proxy_state = apply_pac_profile(profile, &state).await?;
            broadcast_proxy_state(&app, &proxy_state);
        }
        ProxyMode::Off => {}
    }

    Ok(saved)
}

#[tauri::command]
async fn enable_manual(
    app: AppHandle,
    profile: ProxyProfile,
    state: tauri::State<'_, AppState>,
) -> Result<ProxyState, String> {
    let proxy_state = apply_manual_profile(profile, &state).await?;
    broadcast_proxy_state(&app, &proxy_state);
    Ok(proxy_state)
}

async fn apply_manual_profile(
    mut profile: ProxyProfile,
    state: &AppState,
) -> Result<ProxyState, String> {
    profile.mode = ProxyMode::Manual;
    let (profile, unified) = {
        let mut store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        let saved = store
            .save_profile(profile)
            .map_err(|error| error.to_string())?;
        (saved, store.unified_lists().clone())
    };

    {
        let mut server = state
            .pac_server
            .lock()
            .map_err(|_| "PAC服务锁已损坏".to_string())?;
        server.stop();
    }

    let applied_profile = profile.clone();
    if let Err(error) =
        run_blocking(move || platform::enable_manual(&applied_profile, &unified)).await
    {
        return Err(error);
    }
    Ok(logical_proxy_state(platform::read_state(), &profile))
}

#[tauri::command]
async fn enable_pac(
    app: AppHandle,
    profile: ProxyProfile,
    state: tauri::State<'_, AppState>,
) -> Result<ProxyState, String> {
    let proxy_state = apply_pac_profile(profile, &state).await?;
    broadcast_proxy_state(&app, &proxy_state);
    Ok(proxy_state)
}

async fn apply_pac_profile(
    mut profile: ProxyProfile,
    state: &AppState,
) -> Result<ProxyState, String> {
    profile.mode = ProxyMode::Pac;
    let (profile, unified) = {
        let mut store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        let saved = store
            .save_profile(profile)
            .map_err(|error| error.to_string())?;
        (saved, store.unified_lists().clone())
    };

    let content = write_pac_file(&profile, &unified).map_err(|error| error.to_string())?;
    let pac_url = {
        let mut server = state
            .pac_server
            .lock()
            .map_err(|_| "PAC服务锁已损坏".to_string())?;
        server
            .start(content, 18765)
            .map_err(|error| error.to_string())?
    };

    run_blocking(move || platform::enable_pac(&pac_url)).await?;
    Ok(logical_proxy_state(platform::read_state(), &profile))
}

#[tauri::command]
async fn disable_proxy(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<ProxyState, String> {
    let proxy_state = apply_disable_proxy(&state).await?;
    broadcast_proxy_state(&app, &proxy_state);
    Ok(proxy_state)
}

async fn apply_disable_proxy(state: &AppState) -> Result<ProxyState, String> {
    run_blocking(platform::disable_proxy).await?;
    {
        let mut server = state
            .pac_server
            .lock()
            .map_err(|_| "PAC服务锁已损坏".to_string())?;
        server.stop();
    }
    {
        let mut store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        let mut profile = store.active_profile();
        profile.mode = ProxyMode::Off;
        store
            .save_profile(profile)
            .map_err(|error| error.to_string())?;
    }
    Ok(platform::read_state())
}

async fn run_blocking<F>(action: F) -> Result<(), String>
where
    F: FnOnce() -> anyhow::Result<()> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn test_proxy(profile: ProxyProfile) -> Result<TestResult, String> {
    Ok(net::test_proxy(&profile).await)
}

#[tauri::command]
async fn refresh_ip_info(
    use_proxy: bool,
    state: tauri::State<'_, AppState>,
) -> Result<IpInfo, String> {
    if use_proxy && matches!(platform::read_state().mode, ProxyMode::Off) {
        return Ok(net::proxy_disabled_ip_info());
    }

    let profile = {
        let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        store.active_profile()
    };
    net::refresh_ip_info(&profile, use_proxy)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_proxy_speed_test(
    profile: ProxyProfile,
    config: SpeedTestConfig,
) -> Result<SpeedTestResult, String> {
    Ok(net::run_proxy_speed_test(&profile, &config).await)
}

#[tauri::command]
fn get_network_traffic_sample() -> Result<NetworkTrafficSample, String> {
    let (received_bytes, sent_bytes) =
        platform::network_traffic_totals().map_err(|error| error.to_string())?;

    Ok(NetworkTrafficSample {
        received_bytes,
        sent_bytes,
        timestamp_ms: current_timestamp_ms()?,
    })
}

fn current_timestamp_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis()
        .min(u64::MAX as u128) as u64)
}

fn logical_proxy_state(mut proxy_state: ProxyState, profile: &ProxyProfile) -> ProxyState {
    if matches!(proxy_state.mode, ProxyMode::Manual) {
        proxy_state.address = Some(profile.address());
    }
    proxy_state
}

fn logical_current_proxy_state(state: &AppState) -> ProxyState {
    let proxy_state = platform::read_state();
    let Ok(store) = state.store.lock() else {
        return proxy_state;
    };
    logical_proxy_state(proxy_state, &store.active_profile())
}

#[tauri::command]
async fn get_quick_site_icon(
    site_id: String,
    domain: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let site_id = sanitize_cache_key(&site_id);
    let domain = domain.trim().to_ascii_lowercase();
    if site_id.is_empty() || domain.is_empty() || domain.contains('/') || domain.contains('\\') {
        return Err("快捷网站图标参数无效".to_string());
    }

    let dir = config::config_dir()
        .map_err(|error| error.to_string())?
        .join("favicons");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("{site_id}.icon"));

    if path.exists() {
        match favicon_data_url_from_file(&path) {
            Ok(icon) => return Ok(icon),
            Err(_) => {
                let _ = fs::remove_file(&path);
            }
        }
    }

    let encoded_domain = urlencoding::encode(&domain);
    let urls = [
        format!("https://www.google.com/s2/favicons?domain={encoded_domain}&sz=64"),
        format!("http://icons.duckduckgo.com/ip3/{encoded_domain}.ico"),
        format!("https://icons.duckduckgo.com/ip3/{encoded_domain}.ico"),
        format!("https://{domain}/favicon.ico"),
    ];
    let mut failures = Vec::new();
    let profile = {
        let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        store.active_profile()
    };
    let mut clients = Vec::new();

    let proxy_address = format!("http://{}", profile.address());
    match reqwest::Proxy::all(&proxy_address) {
        Ok(proxy) => match reqwest::Client::builder()
            .proxy(proxy)
            .timeout(Duration::from_secs(6))
            .user_agent("Haruha/0.1 favicon-cache")
            .build()
        {
            Ok(client) => clients.push(("代理", client)),
            Err(error) => failures.push(format!("创建图标代理客户端失败: {error:?}")),
        },
        Err(error) => failures.push(format!("图标代理地址无效 {proxy_address}: {error:?}")),
    }

    match reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(6))
        .user_agent("Haruha/0.1 favicon-cache")
        .build()
    {
        Ok(client) => clients.push(("直连", client)),
        Err(error) => failures.push(format!("创建图标直连客户端失败: {error:?}")),
    }

    for (route, client) in clients {
        for url in &urls {
            let response = match client.get(url.as_str()).send().await {
                Ok(response) => response,
                Err(error) => {
                    failures.push(format!("{route} {url}: {error:?}"));
                    continue;
                }
            };
            if !response.status().is_success() {
                failures.push(format!("{route} {url}: {}", response.status()));
                continue;
            }

            let mime = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.split(';').next())
                .filter(|value| value.starts_with("image/"))
                .unwrap_or("image/x-icon")
                .to_string();
            let bytes = match response.bytes().await {
                Ok(bytes) if !bytes.is_empty() && bytes.len() <= 256 * 1024 => bytes,
                Ok(_) => {
                    failures.push(format!("{route} {url}: 图标内容异常"));
                    continue;
                }
                Err(error) => {
                    failures.push(format!("{route} {url}: {error:?}"));
                    continue;
                }
            };
            if bytes.starts_with(b"<!DOCTYPE") || bytes.starts_with(b"<html") {
                failures.push(format!("{route} {url}: 返回了网页而不是图标"));
                continue;
            }

            let cache_value = format!("{mime}\n");
            fs::write(
                &path,
                [FAVICON_CACHE_HEADER, cache_value.as_bytes(), &bytes].concat(),
            )
            .map_err(|error| error.to_string())?;
            return Ok(favicon_data_url(&mime, &bytes));
        }
    }

    Err(format!("获取快捷网站图标失败：{}", failures.join("；")))
}

#[tauri::command]
fn open_config_dir() -> Result<(), String> {
    let dir = config::config_dir().map_err(|error| error.to_string())?;
    open_path(&dir).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_config_dir() -> Result<String, String> {
    let dir = config::config_dir().map_err(|error| error.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

fn sanitize_cache_key(value: &str) -> String {
    value
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                Some(character)
            } else {
                None
            }
        })
        .collect()
}

fn favicon_data_url_from_file(path: &Path) -> Result<String, String> {
    let raw = fs::read(path).map_err(|error| error.to_string())?;
    if !raw.starts_with(FAVICON_CACHE_HEADER) {
        return Err("快捷网站图标缓存版本已过期".to_string());
    }
    let payload = &raw[FAVICON_CACHE_HEADER.len()..];
    let Some(split_at) = payload.iter().position(|byte| *byte == b'\n') else {
        return Err("快捷网站图标缓存格式无效".to_string());
    };
    let mime = std::str::from_utf8(&payload[..split_at]).map_err(|error| error.to_string())?;
    let bytes = &payload[split_at + 1..];
    if !mime.starts_with("image/") || bytes.is_empty() || bytes.len() > 256 * 1024 {
        return Err("快捷网站图标缓存内容无效".to_string());
    }
    Ok(favicon_data_url(mime, bytes))
}

fn favicon_data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(bytes)
    )
}

#[tauri::command]
fn open_google() -> Result<(), String> {
    open_url("https://www.google.com/").map_err(|error| error.to_string())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("只能打开 http:// 或 https:// 地址".to_string());
    }
    open_url(trimmed).map_err(|error| error.to_string())
}

fn restore_proxy_runtime(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let system_mode = platform::read_state().mode;
    let (profile, unified) = {
        let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        (store.active_profile(), store.unified_lists().clone())
    };

    let desired_mode = if profile.mode != ProxyMode::Off {
        profile.mode.clone()
    } else {
        system_mode
    };
    if desired_mode == ProxyMode::Off {
        return Ok(());
    }

    match desired_mode {
        ProxyMode::Manual => {
            platform::enable_manual(&profile, &unified).map_err(|error| error.to_string())
        }
        ProxyMode::Pac => {
            let content = write_pac_file(&profile, &unified).map_err(|error| error.to_string())?;
            let pac_url = {
                let mut server = state
                    .pac_server
                    .lock()
                    .map_err(|_| "PAC服务锁已损坏".to_string())?;
                server
                    .start(content, 18765)
                    .map_err(|error| error.to_string())?
            };
            platform::enable_pac(&pac_url).map_err(|error| error.to_string())
        }
        ProxyMode::Off => Ok(()),
    }
}

fn open_path(path: &std::path::Path) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(path).status()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).status()?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).status()?;
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        anyhow::bail!("当前平台暂不支持打开配置目录")
    }
}

fn open_url(url: &str) -> anyhow::Result<()> {
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .status()?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).status()?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(url).status()?;
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        anyhow::bail!("当前平台暂不支持打开浏览器")
    }
}

const TRAY_PANEL_WIDTH: f64 = 336.0;
const TRAY_PANEL_HEIGHT: f64 = 416.0;
const TRAY_ICON_SIZE: u32 = 32;
const TRAY_ICON_ON_RGBA: &[u8] = include_bytes!("../icons/haruha-tray-icon-32.rgba");
const TRAY_ICON_OFF_RGBA: &[u8] = include_bytes!("../icons/haruha-tray-icon-off-32.rgba");

fn build_tray_icon_for_mode(mode: &ProxyMode) -> Image<'static> {
    let rgba = if matches!(mode, ProxyMode::Off) {
        TRAY_ICON_OFF_RGBA
    } else {
        TRAY_ICON_ON_RGBA
    };
    Image::new(rgba, TRAY_ICON_SIZE, TRAY_ICON_SIZE)
}

fn sync_tray_icon(app: &AppHandle, proxy_state: &ProxyState) {
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };

    let _ = tray.set_icon(Some(build_tray_icon_for_mode(&proxy_state.mode)));
    let mode_label = match proxy_state.mode {
        ProxyMode::Manual => "手动代理",
        ProxyMode::Pac => "PAC 代理",
        ProxyMode::Off => "代理已关闭",
    };
    let _ = tray.set_tooltip(Some(format!("Haruha · {mode_label}")));
}

#[cfg(test)]
mod tray_icon_tests {
    use super::*;

    fn pixel(image: &Image<'_>, x: u32, y: u32) -> [u8; 4] {
        let index = ((y * image.width() + x) * 4) as usize;
        image.rgba()[index..index + 4].try_into().unwrap()
    }

    #[test]
    fn tray_icon_uses_white_background_and_mode_logo() {
        let enabled = build_tray_icon_for_mode(&ProxyMode::Manual);
        let disabled = build_tray_icon_for_mode(&ProxyMode::Off);

        assert_eq!((enabled.width(), enabled.height()), (32, 32));
        assert_eq!(pixel(&enabled, 0, 0)[3], 0);
        assert_eq!(pixel(&enabled, 30, 2), [255, 255, 255, 255]);
        assert_eq!(pixel(&enabled, 16, 16)[3], 255);
        assert_ne!(enabled.rgba(), disabled.rgba());
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let current_state = logical_current_proxy_state(&app.state::<AppState>());
    let tray_window_builder =
        WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("index.html?view=tray".into()))
            .title("Haruha 快捷面板")
            .inner_size(TRAY_PANEL_WIDTH, TRAY_PANEL_HEIGHT)
            .resizable(false)
            .decorations(false);

    #[cfg(not(target_os = "macos"))]
    let tray_window_builder = tray_window_builder.transparent(true);

    tray_window_builder
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Haruha")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                hide_tray_panel(tray.app_handle());
                show_main_window(tray.app_handle());
            }
            TrayIconEvent::Click {
                button: MouseButton::Right,
                button_state: MouseButtonState::Up,
                position,
                ..
            } => toggle_tray_panel(tray.app_handle(), position),
            _ => {}
        });

    builder = builder.icon(build_tray_icon_for_mode(&current_state.mode));

    builder.build(app)?;
    broadcast_proxy_state(app.app_handle(), &current_state);
    Ok(())
}

fn toggle_tray_panel(app: &AppHandle, click_position: PhysicalPosition<f64>) {
    let Some(window) = app.get_webview_window("tray") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }

    position_tray_panel(app, &window, click_position);
    let _ = window.show();
    let _ = window.set_focus();
    broadcast_proxy_state(app, &logical_current_proxy_state(&app.state::<AppState>()));
}

fn position_tray_panel(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    click_position: PhysicalPosition<f64>,
) {
    let Ok(Some(monitor)) = app.monitor_from_point(click_position.x, click_position.y) else {
        return;
    };

    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor();
    let panel_size = window.outer_size().unwrap_or_else(|_| {
        tauri::PhysicalSize::new(
            (TRAY_PANEL_WIDTH * scale_factor).round() as u32,
            (TRAY_PANEL_HEIGHT * scale_factor).round() as u32,
        )
    });
    let gap = (8.0 * scale_factor).round() as i32;
    let work_left = work_area.position.x;
    let work_top = work_area.position.y;
    let work_right = work_left + work_area.size.width as i32;
    let work_bottom = work_top + work_area.size.height as i32;
    let panel_width = panel_size.width as i32;
    let panel_height = panel_size.height as i32;
    let click_x = click_position.x.round() as i32;
    let click_y = click_position.y.round() as i32;

    let max_x = (work_right - panel_width - gap).max(work_left + gap);
    let x = (click_x - panel_width / 2).clamp(work_left + gap, max_x);
    let y = if click_y >= work_bottom {
        work_bottom - panel_height - gap
    } else if click_y <= work_top {
        work_top + gap
    } else if click_y - panel_height - gap >= work_top {
        click_y - panel_height - gap
    } else {
        (click_y + gap).min(work_bottom - panel_height - gap)
    };

    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_tray_panel(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("tray") {
        let _ = window.hide();
    }
}

async fn apply_mode_from_app(app: &AppHandle, mode: ProxyMode) -> Result<ProxyState, String> {
    let state = app.state::<AppState>();
    match mode {
        ProxyMode::Manual => {
            let profile = active_profile_from_state(&state)?;
            apply_manual_profile(profile, &state).await
        }
        ProxyMode::Pac => {
            let profile = active_profile_from_state(&state)?;
            apply_pac_profile(profile, &state).await
        }
        ProxyMode::Off => apply_disable_proxy(&state).await,
    }
}

fn active_profile_from_state(state: &AppState) -> Result<ProxyProfile, String> {
    let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
    Ok(store.active_profile())
}

fn broadcast_proxy_state(app: &AppHandle, proxy_state: &ProxyState) {
    sync_tray_icon(app, proxy_state);
    let _ = app.emit("proxy-state-changed", proxy_state);
}

#[tauri::command]
fn show_main_window_from_tray(app: AppHandle) {
    show_main_window(&app);
}

#[tauri::command]
fn hide_tray_panel_from_ui(app: AppHandle) {
    hide_tray_panel(&app);
}

#[tauri::command]
fn quit_from_tray(app: AppHandle) {
    hide_tray_panel(&app);
    exit_from_tray(app);
}

fn exit_from_tray(app: AppHandle) {
    if let Ok(mut is_exiting) = app.state::<AppState>().is_exiting.lock() {
        *is_exiting = true;
    }

    tauri::async_runtime::spawn(async move {
        if let Err(error) = apply_mode_from_app(&app, ProxyMode::Off).await {
            eprintln!("退出前关闭代理失败: {error}");
        }
        if let Ok(mut server) = app.state::<AppState>().pac_server.lock() {
            server.stop();
        }
        app.exit(0);
    });
}

pub fn run() {
    let store = ConfigStore::load().expect("无法初始化配置");

    tauri::Builder::default()
        .manage(AppState {
            store: Mutex::new(store),
            pac_server: Mutex::new(PacServer::new()),
            is_exiting: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            append_app_log,
            get_proxy_state,
            get_active_profile,
            save_profile,
            get_unified_lists,
            save_unified_lists,
            enable_manual,
            enable_pac,
            disable_proxy,
            test_proxy,
            refresh_ip_info,
            run_proxy_speed_test,
            get_network_traffic_sample,
            get_quick_site_icon,
            get_config_dir,
            open_config_dir,
            open_google,
            open_external_url,
            show_main_window_from_tray,
            hide_tray_panel_from_ui,
            quit_from_tray
        ])
        .on_window_event(|window, event| {
            if window.label() == "tray" {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
                return;
            }
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let is_exiting = window
                    .app_handle()
                    .state::<AppState>()
                    .is_exiting
                    .lock()
                    .map(|value| *value)
                    .unwrap_or(false);
                if !is_exiting {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Haruha");
            }
            if let Err(error) = restore_proxy_runtime(app.state::<AppState>()) {
                eprintln!("恢复代理运行服务失败: {error}");
            }
            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 Haruha 失败");
}

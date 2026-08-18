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
mod single_instance;
mod traffic_monitor;
mod updater;

use config::{append_app_log_line, write_pac_file, ConfigStore};
use models::{
    DirectIpInfo, IpInfo, NetworkTrafficSample, ProxyMode, ProxyProfile, ProxyState,
    SpeedTestConfig, SpeedTestProgress, SpeedTestResult, TestResult, TrafficMonitorCapability,
    TrafficMonitorSnapshot, UnifiedLists,
};
use pac_server::PacServer;

pub(crate) const MAIN_WINDOW_TITLE: &str = "Haruha";
const FAVICON_CACHE_HEADER: &[u8] = b"haruha-favicon-v2\n";

struct AppState {
    store: Mutex<ConfigStore>,
    pac_server: Mutex<PacServer>,
    mode_change: tokio::sync::Mutex<()>,
    last_proxy_state: Mutex<Option<ProxyState>>,
    is_exiting: Mutex<bool>,
    traffic_monitor: traffic_monitor::TrafficMonitorManager,
    updater: updater::UpdateManager,
    _single_instance: single_instance::SingleInstanceGuard,
}

#[derive(Clone)]
struct RuntimeSnapshot {
    profile: ProxyProfile,
    unified: UnifiedLists,
    #[cfg(not(windows))]
    system_state: ProxyState,
    #[cfg(windows)]
    pac_server_port: Option<u16>,
    #[cfg(windows)]
    system_proxy: platform::SystemProxySnapshot,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedConfiguration {
    profile: ProxyProfile,
    unified_lists: UnifiedLists,
    proxy_state: ProxyState,
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
async fn save_profile(
    profile: ProxyProfile,
    state: tauri::State<'_, AppState>,
) -> Result<ProxyProfile, String> {
    let _mode_change = state.mode_change.lock().await;
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
    let _mode_change = state.mode_change.lock().await;
    let lists = ConfigStore::prepare_unified_lists(lists);
    let previous = runtime_snapshot(&state)?;
    let pac_content =
        write_pac_file(&previous.profile, &lists).map_err(|error| error.to_string())?;

    // 名单变更后始终刷新磁盘 PAC；当前模式需要时再应用系统设置，最后提交配置。
    // 任一步失败都恢复旧 PAC、系统代理和持久化状态。
    match previous.profile.mode {
        ProxyMode::Manual => {
            let profile = previous.profile.clone();
            let applied_lists = lists.clone();
            if let Err(error) =
                run_blocking(move || platform::enable_manual(&profile, &applied_lists)).await
            {
                return Err(error_with_rollback(error, &state, &previous).await);
            }
        }
        ProxyMode::Pac => {
            let pac_url = match start_pac_server(&state, pac_content) {
                Ok(url) => url,
                Err(error) => return Err(error_with_rollback(error, &state, &previous).await),
            };
            if let Err(error) = run_blocking(move || platform::enable_pac(&pac_url)).await {
                return Err(error_with_rollback(error, &state, &previous).await);
            }
        }
        ProxyMode::Off => {}
    }

    let saved = {
        let mut store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        store
            .set_unified_lists(lists)
            .map_err(|error| error.to_string())
    };
    let saved = match saved {
        Ok(saved) => saved,
        Err(error) => return Err(error_with_rollback(error, &state, &previous).await),
    };
    if previous.profile.mode != ProxyMode::Off {
        let proxy_state = logical_current_proxy_state(&state);
        broadcast_proxy_state(&app, &proxy_state);
    }

    Ok(saved)
}

#[tauri::command]
async fn save_configuration(
    app: AppHandle,
    profile: ProxyProfile,
    lists: UnifiedLists,
    state: tauri::State<'_, AppState>,
) -> Result<SavedConfiguration, String> {
    let _mode_change = state.mode_change.lock().await;
    let profile = ConfigStore::prepare_profile(profile).map_err(|error| error.to_string())?;
    let lists = ConfigStore::prepare_unified_lists(lists);
    let previous = runtime_snapshot(&state)?;
    let pac_content = write_pac_file(&profile, &lists).map_err(|error| error.to_string())?;

    match profile.mode {
        ProxyMode::Manual => {
            let applied_profile = profile.clone();
            let applied_lists = lists.clone();
            if let Err(error) =
                run_blocking(move || platform::enable_manual(&applied_profile, &applied_lists))
                    .await
            {
                return Err(error_with_rollback(error, &state, &previous).await);
            }
            if let Err(error) = stop_pac_server(&state) {
                return Err(error_with_rollback(error, &state, &previous).await);
            }
        }
        ProxyMode::Pac => {
            let pac_url = match start_pac_server(&state, pac_content) {
                Ok(url) => url,
                Err(error) => return Err(error_with_rollback(error, &state, &previous).await),
            };
            if let Err(error) = run_blocking(move || platform::enable_pac(&pac_url)).await {
                return Err(error_with_rollback(error, &state, &previous).await);
            }
        }
        ProxyMode::Off => {
            if let Err(error) = run_blocking(platform::disable_proxy).await {
                return Err(error_with_rollback(error, &state, &previous).await);
            }
            if let Err(error) = stop_pac_server(&state) {
                return Err(error_with_rollback(error, &state, &previous).await);
            }
        }
    }

    let saved = {
        let mut store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        store
            .save_configuration(profile, lists)
            .map_err(|error| error.to_string())
    };
    let (profile, unified_lists) = match saved {
        Ok(saved) => saved,
        Err(error) => return Err(error_with_rollback(error, &state, &previous).await),
    };
    let proxy_state = logical_proxy_state(platform::read_state(), &profile);
    broadcast_proxy_state(&app, &proxy_state);

    Ok(SavedConfiguration {
        profile,
        unified_lists,
        proxy_state,
    })
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
    profile: ProxyProfile,
    state: &AppState,
) -> Result<ProxyState, String> {
    let _mode_change = state.mode_change.lock().await;
    apply_manual_profile_locked(profile, state).await
}

async fn apply_manual_profile_locked(
    mut profile: ProxyProfile,
    state: &AppState,
) -> Result<ProxyState, String> {
    profile.mode = ProxyMode::Manual;
    let profile = ConfigStore::prepare_profile(profile).map_err(|error| error.to_string())?;
    let previous = runtime_snapshot(state)?;
    let unified = previous.unified.clone();

    let applied_profile = profile.clone();
    if let Err(error) =
        run_blocking(move || platform::enable_manual(&applied_profile, &unified)).await
    {
        return Err(error_with_rollback(error, state, &previous).await);
    }
    if let Err(error) = stop_pac_server(state) {
        return Err(error_with_rollback(error, state, &previous).await);
    }
    if let Err(error) = save_profile_to_state(state, profile.clone()) {
        return Err(error_with_rollback(error, state, &previous).await);
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

async fn apply_pac_profile(profile: ProxyProfile, state: &AppState) -> Result<ProxyState, String> {
    let _mode_change = state.mode_change.lock().await;
    apply_pac_profile_locked(profile, state).await
}

async fn apply_pac_profile_locked(
    mut profile: ProxyProfile,
    state: &AppState,
) -> Result<ProxyState, String> {
    profile.mode = ProxyMode::Pac;
    let profile = ConfigStore::prepare_profile(profile).map_err(|error| error.to_string())?;
    let previous = runtime_snapshot(state)?;
    let unified = previous.unified.clone();

    let content = write_pac_file(&profile, &unified).map_err(|error| error.to_string())?;
    let pac_url = match start_pac_server(state, content) {
        Ok(url) => url,
        Err(error) => return Err(error_with_rollback(error, state, &previous).await),
    };

    if let Err(error) = run_blocking(move || platform::enable_pac(&pac_url)).await {
        return Err(error_with_rollback(error, state, &previous).await);
    }
    if let Err(error) = save_profile_to_state(state, profile.clone()) {
        return Err(error_with_rollback(error, state, &previous).await);
    }
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
    let _mode_change = state.mode_change.lock().await;
    apply_disable_proxy_locked(state).await
}

async fn apply_disable_proxy_locked(state: &AppState) -> Result<ProxyState, String> {
    let previous = runtime_snapshot(state)?;
    if let Err(error) = run_blocking(platform::disable_proxy).await {
        return Err(error_with_rollback(error, state, &previous).await);
    }
    if let Err(error) = stop_pac_server(state) {
        return Err(error_with_rollback(error, state, &previous).await);
    }
    let mut profile = previous.profile.clone();
    profile.mode = ProxyMode::Off;
    if let Err(error) = save_profile_to_state(state, profile) {
        return Err(error_with_rollback(error, state, &previous).await);
    }
    Ok(platform::read_state())
}

fn runtime_snapshot(state: &AppState) -> Result<RuntimeSnapshot, String> {
    let (profile, unified) = {
        let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        (store.active_profile(), store.unified_lists().clone())
    };
    #[cfg(windows)]
    let pac_server_port = state
        .pac_server
        .lock()
        .map_err(|_| "PAC服务锁已损坏".to_string())?
        .port();
    Ok(RuntimeSnapshot {
        profile,
        unified,
        #[cfg(not(windows))]
        system_state: platform::read_state(),
        #[cfg(windows)]
        pac_server_port,
        #[cfg(windows)]
        system_proxy: platform::capture_system_proxy_snapshot()
            .map_err(|error| error.to_string())?,
    })
}

fn save_profile_to_state(state: &AppState, profile: ProxyProfile) -> Result<ProxyProfile, String> {
    let mut store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
    store
        .save_profile(profile)
        .map_err(|error| error.to_string())
}

fn start_pac_server(state: &AppState, content: String) -> Result<String, String> {
    let mut server = state
        .pac_server
        .lock()
        .map_err(|_| "PAC服务锁已损坏".to_string())?;
    server
        .start(content, 18765)
        .map_err(|error| error.to_string())
}

fn stop_pac_server(state: &AppState) -> Result<(), String> {
    let mut server = state
        .pac_server
        .lock()
        .map_err(|_| "PAC服务锁已损坏".to_string())?;
    server.stop();
    Ok(())
}

async fn error_with_rollback(
    original_error: String,
    state: &AppState,
    snapshot: &RuntimeSnapshot,
) -> String {
    match restore_runtime_snapshot(state, snapshot).await {
        Ok(()) => original_error,
        Err(rollback_error) => {
            format!("{original_error}；恢复原代理状态也失败: {rollback_error}")
        }
    }
}

async fn restore_runtime_snapshot(
    state: &AppState,
    snapshot: &RuntimeSnapshot,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let pac_result = restore_pac_server_snapshot(state, snapshot);
        let system_proxy = snapshot.system_proxy.clone();
        let system_result =
            run_blocking(move || platform::restore_system_proxy_snapshot(&system_proxy)).await;
        return combine_restore_results(pac_result, system_result);
    }

    #[cfg(not(windows))]
    {
        let previous_pac_content = write_pac_file(&snapshot.profile, &snapshot.unified)
            .map_err(|error| error.to_string())?;
        let desired_mode = if snapshot.profile.mode == ProxyMode::Off {
            snapshot.system_state.mode.clone()
        } else {
            snapshot.profile.mode.clone()
        };

        match desired_mode {
            ProxyMode::Manual => {
                let mut profile = snapshot.profile.clone();
                if snapshot.profile.mode == ProxyMode::Off {
                    let address = snapshot
                        .system_state
                        .address
                        .as_deref()
                        .ok_or_else(|| "无法读取原手动代理地址".to_string())?;
                    let (host, port) = split_proxy_address(address)
                        .ok_or_else(|| "无法解析原手动代理地址".to_string())?;
                    profile.host = host;
                    profile.port = port;
                }
                let unified = snapshot.unified.clone();
                let restored =
                    run_blocking(move || platform::enable_manual(&profile, &unified)).await;
                let stopped = stop_pac_server(state);
                restored?;
                stopped
            }
            ProxyMode::Pac => {
                if snapshot.profile.mode == ProxyMode::Off {
                    let pac_url = snapshot
                        .system_state
                        .pac_url
                        .clone()
                        .ok_or_else(|| "无法读取原 PAC 地址".to_string())?;
                    let restored = run_blocking(move || platform::enable_pac(&pac_url)).await;
                    let stopped = stop_pac_server(state);
                    restored?;
                    return stopped;
                }
                let pac_url = start_pac_server(state, previous_pac_content)?;
                run_blocking(move || platform::enable_pac(&pac_url)).await
            }
            ProxyMode::Off => {
                let restored = run_blocking(platform::disable_proxy).await;
                let stopped = stop_pac_server(state);
                restored?;
                stopped
            }
        }
    }
}

#[cfg(windows)]
fn restore_pac_server_snapshot(state: &AppState, snapshot: &RuntimeSnapshot) -> Result<(), String> {
    let content =
        write_pac_file(&snapshot.profile, &snapshot.unified).map_err(|error| error.to_string())?;
    let mut server = state
        .pac_server
        .lock()
        .map_err(|_| "PAC服务锁已损坏".to_string())?;

    match snapshot.pac_server_port {
        Some(port) => {
            server
                .start(content, port)
                .map_err(|error| error.to_string())?;
            if server.port() != Some(port) {
                let actual_port = server.port();
                server.stop();
                return Err(format!(
                    "无法在原端口 {port} 恢复 PAC 服务，实际绑定端口: {actual_port:?}"
                ));
            }
        }
        None => server.stop(),
    }
    Ok(())
}

#[cfg(windows)]
fn combine_restore_results(
    pac_result: Result<(), String>,
    system_result: Result<(), String>,
) -> Result<(), String> {
    match (pac_result, system_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(pac_error), Ok(())) => Err(format!("恢复 PAC 运行状态失败: {pac_error}")),
        (Ok(()), Err(system_error)) => Err(format!("恢复系统代理快照失败: {system_error}")),
        (Err(pac_error), Err(system_error)) => Err(format!(
            "恢复 PAC 运行状态失败: {pac_error}；恢复系统代理快照失败: {system_error}"
        )),
    }
}

#[cfg(any(not(windows), test))]
fn split_proxy_address(address: &str) -> Option<(String, u16)> {
    let address = address.trim();
    let separator = address.rfind(':')?;
    let host = address[..separator].trim();
    let port = address[separator + 1..].trim().parse().ok()?;
    if host.is_empty() || port == 0 {
        return None;
    }
    Some((host.to_string(), port))
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
    let profile = ConfigStore::prepare_profile(profile).map_err(|error| error.to_string())?;
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
async fn refresh_direct_ip_info() -> Result<DirectIpInfo, String> {
    net::refresh_direct_ip_info()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_proxy_speed_test(
    profile: ProxyProfile,
    config: SpeedTestConfig,
    app: AppHandle,
) -> Result<SpeedTestResult, String> {
    let profile = ConfigStore::prepare_profile(profile).map_err(|error| error.to_string())?;
    let emit_progress = move |progress: SpeedTestProgress| {
        let _ = app.emit("speed-test-progress", progress);
    };
    Ok(net::run_proxy_speed_test(&profile, &config, &emit_progress).await)
}

#[tauri::command]
async fn run_direct_speed_test(
    config: SpeedTestConfig,
    app: AppHandle,
) -> Result<SpeedTestResult, String> {
    let emit_progress = move |progress: SpeedTestProgress| {
        let _ = app.emit("speed-test-progress", progress);
    };
    Ok(net::run_direct_speed_test(&config, &emit_progress).await)
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

#[tauri::command]
fn get_traffic_monitor_capability(state: tauri::State<'_, AppState>) -> TrafficMonitorCapability {
    state.traffic_monitor.capability()
}

#[tauri::command]
async fn start_traffic_monitor(
    state: tauri::State<'_, AppState>,
) -> Result<TrafficMonitorSnapshot, String> {
    let monitor = state.traffic_monitor.clone();
    tauri::async_runtime::spawn_blocking(move || monitor.start())
        .await
        .map_err(|error| format!("启动应用流量监控任务失败：{error}"))?
}

#[tauri::command]
fn get_traffic_monitor_snapshot(state: tauri::State<'_, AppState>) -> TrafficMonitorSnapshot {
    state.traffic_monitor.snapshot()
}

#[tauri::command]
fn stop_traffic_monitor(state: tauri::State<'_, AppState>) -> TrafficMonitorSnapshot {
    state.traffic_monitor.stop()
}

#[tauri::command]
async fn get_traffic_application_icon(
    application_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let path = state
        .traffic_monitor
        .application_path(application_id.trim())
        .ok_or_else(|| "该应用没有可读取的图标".to_string())?;
    tauri::async_runtime::spawn_blocking(move || traffic_monitor::application_icon_data_url(&path))
        .await
        .map_err(|error| format!("读取应用图标任务失败：{error}"))?
}

fn current_timestamp_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis()
        .min(u64::MAX as u128) as u64)
}

fn logical_proxy_state(mut proxy_state: ProxyState, profile: &ProxyProfile) -> ProxyState {
    if matches!(proxy_state.mode, ProxyMode::Manual)
        && proxy_state
            .address
            .as_deref()
            .map(|address| address.trim().is_empty())
            .unwrap_or(true)
    {
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

fn update_proxy_address(state: &tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    let profile = state
        .store
        .lock()
        .map_err(|_| "配置锁已损坏".to_string())?
        .active_profile();
    Ok((profile.mode != ProxyMode::Off).then(|| format!("http://{}", profile.address())))
}

#[tauri::command]
async fn check_for_updates(
    state: tauri::State<'_, AppState>,
) -> Result<updater::UpdateCheckResult, String> {
    let proxy_address = update_proxy_address(&state)?;
    state
        .updater
        .check(proxy_address.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn download_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<updater::PreparedUpdate, String> {
    let proxy_address = update_proxy_address(&state)?;
    state
        .updater
        .download(&app, proxy_address.as_deref())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_update_download(state: tauri::State<'_, AppState>) {
    state.updater.cancel_download();
}

#[tauri::command]
fn install_update(app: AppHandle, state: tauri::State<'_, AppState>) -> Result<String, String> {
    let version = state
        .updater
        .launch_portable_installer()
        .map_err(|error| error.to_string())?;
    if let Ok(mut is_exiting) = state.is_exiting.lock() {
        *is_exiting = true;
    }
    state.traffic_monitor.shutdown();
    std::thread::spawn({
        let app = app.clone();
        move || {
            std::thread::sleep(Duration::from_millis(300));
            app.exit(0);
        }
    });
    Ok(version)
}

#[tauri::command]
fn get_last_update_result() -> Result<Option<updater::UpdateApplyResult>, String> {
    updater::take_last_apply_result().map_err(|error| error.to_string())
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
    let (profile, unified) = {
        let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
        (store.active_profile(), store.unified_lists().clone())
    };

    // 配置为关闭时尊重现有系统设置，避免首次启动覆盖用户自己的代理。
    if profile.mode == ProxyMode::Off {
        return Ok(());
    }

    match profile.mode {
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
const TRAY_PANEL_HEIGHT: f64 = 286.0;
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
    fn tray_icon_uses_transparent_background_and_mode_logo() {
        let enabled = build_tray_icon_for_mode(&ProxyMode::Manual);
        let disabled = build_tray_icon_for_mode(&ProxyMode::Off);

        assert_eq!((enabled.width(), enabled.height()), (32, 32));
        assert_eq!(pixel(&enabled, 0, 0)[3], 0);
        assert_eq!(pixel(&enabled, 1, 1)[3], 0);
        assert_eq!(pixel(&enabled, 30, 2)[3], 0);
        assert_eq!(pixel(&enabled, 12, 1)[3], 255);
        assert!(pixel(&enabled, 18, 0)[3] > 0);
        assert!(pixel(&enabled, 15, 31)[3] > 0);
        assert_ne!(enabled.rgba(), disabled.rgba());
    }

    #[test]
    fn splits_ipv4_hostname_and_bracketed_ipv6_proxy_addresses() {
        assert_eq!(
            split_proxy_address("127.0.0.1:10808"),
            Some(("127.0.0.1".into(), 10808))
        );
        assert_eq!(
            split_proxy_address("proxy.example.com:8080"),
            Some(("proxy.example.com".into(), 8080))
        );
        assert_eq!(
            split_proxy_address("[2001:db8::1]:3128"),
            Some(("[2001:db8::1]".into(), 3128))
        );
        assert_eq!(split_proxy_address("missing-port"), None);
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
    apply_saved_proxy_mode(mode, &state).await
}

async fn apply_saved_proxy_mode(mode: ProxyMode, state: &AppState) -> Result<ProxyState, String> {
    let _mode_change = state.mode_change.lock().await;
    match mode {
        ProxyMode::Manual => {
            let profile = active_profile_from_state(state)?;
            apply_manual_profile_locked(profile, state).await
        }
        ProxyMode::Pac => {
            let profile = active_profile_from_state(state)?;
            apply_pac_profile_locked(profile, state).await
        }
        ProxyMode::Off => apply_disable_proxy_locked(state).await,
    }
}

#[tauri::command]
async fn set_proxy_mode(
    app: AppHandle,
    mode: ProxyMode,
    state: tauri::State<'_, AppState>,
) -> Result<ProxyState, String> {
    let proxy_state = apply_saved_proxy_mode(mode, &state).await?;
    broadcast_proxy_state(&app, &proxy_state);
    Ok(proxy_state)
}

fn active_profile_from_state(state: &AppState) -> Result<ProxyProfile, String> {
    let store = state.store.lock().map_err(|_| "配置锁已损坏".to_string())?;
    Ok(store.active_profile())
}

fn broadcast_proxy_state(app: &AppHandle, proxy_state: &ProxyState) {
    if let Ok(mut last_proxy_state) = app.state::<AppState>().last_proxy_state.lock() {
        *last_proxy_state = Some(proxy_state.clone());
    }
    sync_tray_icon(app, proxy_state);
    let _ = app.emit("proxy-state-changed", proxy_state);
}

fn refresh_proxy_state_if_changed(app: &AppHandle) {
    let proxy_state = logical_current_proxy_state(&app.state::<AppState>());
    let has_changed = app
        .state::<AppState>()
        .last_proxy_state
        .lock()
        .map(|last_proxy_state| last_proxy_state.as_ref() != Some(&proxy_state))
        .unwrap_or(true);
    if has_changed {
        broadcast_proxy_state(app, &proxy_state);
    }
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
        app.state::<AppState>().traffic_monitor.shutdown();
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
    if updater::run_update_helper_if_requested() {
        return;
    }
    if traffic_monitor::run_helper_if_requested() {
        return;
    }

    let single_instance = match single_instance::acquire() {
        Ok(Some(guard)) => guard,
        Ok(None) => {
            eprintln!("检测到同构建类型的 Haruha 已在运行，当前进程退出");
            return;
        }
        Err(error) => {
            eprintln!("无法建立单实例保护: {error:#}");
            return;
        }
    };
    let store = ConfigStore::load().expect("无法初始化配置");

    tauri::Builder::default()
        .manage(AppState {
            store: Mutex::new(store),
            pac_server: Mutex::new(PacServer::new()),
            mode_change: tokio::sync::Mutex::new(()),
            last_proxy_state: Mutex::new(None),
            is_exiting: Mutex::new(false),
            traffic_monitor: traffic_monitor::TrafficMonitorManager::new(),
            updater: updater::UpdateManager::new(),
            _single_instance: single_instance,
        })
        .invoke_handler(tauri::generate_handler![
            append_app_log,
            get_proxy_state,
            get_active_profile,
            save_profile,
            get_unified_lists,
            save_unified_lists,
            save_configuration,
            enable_manual,
            enable_pac,
            disable_proxy,
            set_proxy_mode,
            test_proxy,
            refresh_direct_ip_info,
            refresh_ip_info,
            run_proxy_speed_test,
            run_direct_speed_test,
            get_network_traffic_sample,
            get_traffic_monitor_capability,
            start_traffic_monitor,
            get_traffic_monitor_snapshot,
            stop_traffic_monitor,
            get_traffic_application_icon,
            get_quick_site_icon,
            get_config_dir,
            open_config_dir,
            check_for_updates,
            download_update,
            cancel_update_download,
            install_update,
            get_last_update_result,
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
            if let WindowEvent::Focused(true) = event {
                refresh_proxy_state_if_changed(window.app_handle());
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
                let _ = window.set_title(MAIN_WINDOW_TITLE);
            }
            if let Err(error) = restore_proxy_runtime(app.state::<AppState>()) {
                eprintln!("恢复代理运行服务失败: {error}");
            }
            setup_tray(app)?;
            updater::schedule_helper_cleanup();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("运行 Haruha 失败");
}

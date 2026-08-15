use crate::models::{TrafficApplicationUsage, TrafficMonitorCapability, TrafficMonitorSnapshot};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

const STATUS_IDLE: &str = "idle";
const STATUS_STARTING: &str = "starting";
const STATUS_RUNNING: &str = "running";
const STATUS_ERROR: &str = "error";
#[cfg(windows)]
const STARTUP_CONFIRMATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(25);
#[cfg(windows)]
const SNAPSHOT_HEARTBEAT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
#[cfg(windows)]
const COLLECTOR_SNAPSHOT_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(250);
#[cfg(windows)]
const APPLICATION_NAME_CACHE_LIMIT: usize = 256;
#[cfg(windows)]
const APPLICATION_NAME_ENRICHMENT_QUEUE_LIMIT: usize = 128;
#[cfg(windows)]
const MAX_VERSION_INFO_BYTES: u32 = 4 * 1024 * 1024;
#[cfg(windows)]
const MAX_APPLICATION_NAME_UTF16_UNITS: u32 = 512;

#[derive(Clone)]
pub struct TrafficMonitorManager {
    inner: Arc<Mutex<MonitorState>>,
}

struct MonitorState {
    generation: u64,
    run_id: u64,
    token: String,
    snapshot: TrafficMonitorSnapshot,
    application_paths: HashMap<String, String>,
    #[cfg(windows)]
    control: Option<std::fs::File>,
    #[cfg(windows)]
    last_message_received_at: Option<std::time::Instant>,
}

impl TrafficMonitorManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(MonitorState {
                generation: 0,
                run_id: 0,
                token: String::new(),
                snapshot: idle_snapshot(None),
                application_paths: HashMap::new(),
                #[cfg(windows)]
                control: None,
                #[cfg(windows)]
                last_message_received_at: None,
            })),
        }
    }

    pub fn capability(&self) -> TrafficMonitorCapability {
        capability()
    }

    pub fn snapshot(&self) -> TrafficMonitorSnapshot {
        #[cfg(windows)]
        {
            let Ok(mut state) = self.inner.lock() else {
                return idle_snapshot(Some("应用流量监控状态锁已损坏".to_string()));
            };
            let heartbeat_expired = state.snapshot.status == STATUS_RUNNING
                && state
                    .last_message_received_at
                    .is_some_and(|received_at| received_at.elapsed() >= SNAPSHOT_HEARTBEAT_TIMEOUT);
            if heartbeat_expired {
                state.snapshot.status = STATUS_ERROR.to_string();
                state.snapshot.error =
                    Some("应用流量采集器超过15秒未发送新快照，请关闭监控后重试".to_string());
                state.generation = state.generation.wrapping_add(1);
                state.run_id = state.run_id.wrapping_add(1);
                state.token.clear();
                state.last_message_received_at = None;
                // Closing the dedicated control pipe makes the helper's blocking read return,
                // which stops this generation without risking another blocking write here.
                let stale_control = state.control.take();
                let snapshot = state.snapshot.clone();
                drop(state);
                drop(stale_control);
                return snapshot;
            }
            return state.snapshot.clone();
        }

        #[cfg(not(windows))]
        {
            self.inner
                .lock()
                .map(|state| state.snapshot.clone())
                .unwrap_or_else(|_| idle_snapshot(Some("应用流量监控状态锁已损坏".to_string())))
        }
    }

    #[cfg(windows)]
    pub fn start(&self) -> Result<TrafficMonitorSnapshot, String> {
        let reused_session = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| "应用流量监控状态锁已损坏".to_string())?;
            if matches!(
                state.snapshot.status.as_str(),
                STATUS_STARTING | STATUS_RUNNING
            ) {
                return Ok(state.snapshot.clone());
            }

            state.run_id = state.run_id.wrapping_add(1);
            let run_id = state.run_id;
            state.snapshot = starting_snapshot();
            state.application_paths.clear();
            state.last_message_received_at = None;

            let generation = state.generation;
            let token = state.token.clone();
            let command = format!("start {token} {run_id}\n");
            let command_result = state.control.as_mut().map(|control| {
                use std::io::Write;
                control
                    .write_all(command.as_bytes())
                    .and_then(|_| control.flush())
            });
            match command_result {
                Some(Ok(())) => Some((generation, run_id)),
                Some(Err(_)) => {
                    state.generation = state.generation.wrapping_add(1);
                    state.control = None;
                    state.token.clear();
                    None
                }
                None => None,
            }
        };

        if let Some((generation, run_id)) = reused_session {
            return self.wait_for_startup(generation, run_id, STARTUP_CONFIRMATION_TIMEOUT);
        }

        let (generation, run_id, token, data_pipe_name, control_pipe_name) = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| "应用流量监控状态锁已损坏".to_string())?;

            state.generation = state.generation.wrapping_add(1);
            let generation = state.generation;
            let run_id = state.run_id;
            let (data_pipe_name, control_pipe_name, token) = session_credentials()?;
            state.token = token.clone();
            state.snapshot = starting_snapshot();
            state.application_paths.clear();
            state.control = None;
            state.last_message_received_at = None;
            (generation, run_id, token, data_pipe_name, control_pipe_name)
        };

        if let Err(error) = launch_elevated_helper(&data_pipe_name, &control_pipe_name, &token) {
            if let Ok(mut state) = self.inner.lock() {
                if state.generation == generation {
                    state.snapshot = idle_snapshot(Some(error.clone()));
                    state.token.clear();
                }
            }
            return Err(error);
        }

        let inner = Arc::clone(&self.inner);
        let worker_data_pipe_name = data_pipe_name.clone();
        let worker_control_pipe_name = control_pipe_name.clone();
        let worker_token = token.clone();
        if let Err(error) = std::thread::Builder::new()
            .name("haruha-traffic-pipe".to_string())
            .spawn(move || {
                run_pipe_client(
                    &worker_data_pipe_name,
                    &worker_control_pipe_name,
                    generation,
                    run_id,
                    worker_token,
                    inner,
                )
            })
        {
            let message = format!("启动应用流量通信线程失败：{error}");
            if let Ok(mut pipe) = connect_to_pipe(&control_pipe_name, TrafficPipeKind::Control) {
                use std::io::Write;
                let _ = pipe.write_all(format!("shutdown {token}\n").as_bytes());
                let _ = pipe.flush();
            }
            if let Ok(mut state) = self.inner.lock() {
                if state.generation == generation {
                    state.snapshot = idle_snapshot(Some(message.clone()));
                    state.token.clear();
                }
            }
            return Err(message);
        }

        self.wait_for_startup(generation, run_id, STARTUP_CONFIRMATION_TIMEOUT)
    }

    #[cfg(not(windows))]
    pub fn start(&self) -> Result<TrafficMonitorSnapshot, String> {
        Err("当前平台暂不支持按应用统计流量".to_string())
    }

    pub fn stop(&self) -> TrafficMonitorSnapshot {
        #[cfg(windows)]
        {
            let Ok(mut state) = self.inner.lock() else {
                return idle_snapshot(Some("应用流量监控状态锁已损坏".to_string()));
            };
            let stopped_run_id = state.run_id;
            state.run_id = state.run_id.wrapping_add(1);
            let token = state.token.clone();
            state.application_paths.clear();
            state.snapshot = idle_snapshot(None);
            state.last_message_received_at = None;
            if let Some(control) = state.control.as_mut() {
                use std::io::Write;
                if control
                    .write_all(format!("stop {token} {stopped_run_id}\n").as_bytes())
                    .and_then(|_| control.flush())
                    .is_err()
                {
                    state.generation = state.generation.wrapping_add(1);
                    state.control = None;
                    state.token.clear();
                }
            }
        }

        #[cfg(not(windows))]
        if let Ok(mut state) = self.inner.lock() {
            state.generation = state.generation.wrapping_add(1);
            state.snapshot = idle_snapshot(None);
            state.application_paths.clear();
        }

        self.snapshot()
    }

    pub fn shutdown(&self) {
        #[cfg(windows)]
        {
            let (mut control, token) = {
                let Ok(mut state) = self.inner.lock() else {
                    return;
                };
                state.generation = state.generation.wrapping_add(1);
                state.run_id = state.run_id.wrapping_add(1);
                let token = std::mem::take(&mut state.token);
                state.application_paths.clear();
                state.snapshot = idle_snapshot(None);
                state.last_message_received_at = None;
                (state.control.take(), token)
            };
            if let Some(control) = control.as_mut() {
                use std::io::Write;
                let _ = control.write_all(format!("shutdown {token}\n").as_bytes());
                let _ = control.flush();
            }
        }

        #[cfg(not(windows))]
        self.stop();
    }

    pub fn application_path(&self, application_id: &str) -> Option<String> {
        self.inner
            .lock()
            .ok()?
            .application_paths
            .get(application_id)
            .cloned()
    }

    #[cfg(windows)]
    fn wait_for_startup(
        &self,
        generation: u64,
        run_id: u64,
        timeout: std::time::Duration,
    ) -> Result<TrafficMonitorSnapshot, String> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let snapshot = {
                let state = self
                    .inner
                    .lock()
                    .map_err(|_| "应用流量监控状态锁已损坏".to_string())?;
                if state.generation != generation || state.run_id != run_id {
                    return Err("应用流量监控启动已取消".to_string());
                }
                state.snapshot.clone()
            };

            match snapshot.status.as_str() {
                STATUS_RUNNING => return Ok(snapshot),
                STATUS_ERROR => {
                    return Err(snapshot
                        .error
                        .unwrap_or_else(|| "应用流量采集器启动失败".to_string()))
                }
                _ if std::time::Instant::now() >= deadline => {
                    self.stop();
                    return Err("应用流量采集器启动超时，请关闭监控后重试".to_string());
                }
                _ => std::thread::sleep(std::time::Duration::from_millis(50)),
            }
        }
    }
}

pub fn capability() -> TrafficMonitorCapability {
    #[cfg(windows)]
    {
        TrafficMonitorCapability {
            supported: true,
            requires_elevation: true,
            reason: None,
        }
    }
    #[cfg(not(windows))]
    {
        TrafficMonitorCapability {
            supported: false,
            requires_elevation: false,
            reason: Some("当前平台暂不支持按应用统计流量".to_string()),
        }
    }
}

pub fn run_helper_if_requested() -> bool {
    #[cfg(windows)]
    {
        let arguments = std::env::args().collect::<Vec<_>>();
        let Some(helper_index) = arguments
            .iter()
            .position(|argument| argument == "--traffic-helper")
        else {
            return false;
        };
        let data_pipe_name = argument_value(&arguments[helper_index + 1..], "--data-pipe");
        let control_pipe_name = argument_value(&arguments[helper_index + 1..], "--control-pipe");
        let token = argument_value(&arguments[helper_index + 1..], "--token");
        if let (Some(data_pipe_name), Some(control_pipe_name), Some(token)) =
            (data_pipe_name, control_pipe_name, token)
        {
            if let Err(error) = run_elevated_helper(&data_pipe_name, &control_pipe_name, &token) {
                eprintln!("应用流量采集器启动失败：{error}");
            }
        }
        true
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
pub fn application_icon_data_url(path: &str) -> Result<String, String> {
    use windows_icons::{get_icon_base64_by_path_with_size, IconSize};

    let encoded = get_icon_base64_by_path_with_size(path, IconSize::Medium)
        .map_err(|error| format!("读取应用图标失败：{error}"))?;
    Ok(format!("data:image/png;base64,{encoded}"))
}

#[cfg(not(windows))]
pub fn application_icon_data_url(_path: &str) -> Result<String, String> {
    Err("当前平台暂不支持读取应用图标".to_string())
}

fn idle_snapshot(error: Option<String>) -> TrafficMonitorSnapshot {
    TrafficMonitorSnapshot {
        status: STATUS_IDLE.to_string(),
        started_at_ms: None,
        updated_at_ms: now_ms(),
        applications: Vec::new(),
        error,
    }
}

fn starting_snapshot() -> TrafficMonitorSnapshot {
    let timestamp = now_ms();
    TrafficMonitorSnapshot {
        status: STATUS_STARTING.to_string(),
        started_at_ms: Some(timestamp),
        updated_at_ms: timestamp,
        applications: Vec::new(),
        error: None,
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn argument_value(arguments: &[String], name: &str) -> Option<String> {
    arguments
        .windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

#[cfg(windows)]
fn session_credentials() -> Result<(String, String, String), String> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };

    let mut random = [0_u8; 32];
    let status = unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            random.as_mut_ptr(),
            random.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        return Err(format!(
            "生成应用流量监控会话凭据失败，NTSTATUS：0x{:08x}",
            status as u32
        ));
    }

    let pipe_nonce = random[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let token = random[16..]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let pipe_prefix = format!(r"\\.\pipe\Haruha.Traffic.{pipe_nonce}");
    Ok((
        format!("{pipe_prefix}.data"),
        format!("{pipe_prefix}.control"),
        token,
    ))
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrafficPipeKind {
    Data,
    Control,
}

#[cfg(windows)]
fn create_pipe_server(pipe_name: &str, kind: TrafficPipeKind) -> Result<isize, String> {
    use windows_sys::Win32::{
        Foundation::{LocalFree, INVALID_HANDLE_VALUE},
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
            },
            PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES,
        },
        Storage::FileSystem::{PIPE_ACCESS_INBOUND, PIPE_ACCESS_OUTBOUND},
        System::Pipes::{
            CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE,
            PIPE_WAIT,
        },
    };

    let name = wide(pipe_name);
    let open_mode = match kind {
        TrafficPipeKind::Data => PIPE_ACCESS_OUTBOUND,
        TrafficPipeKind::Control => PIPE_ACCESS_INBOUND,
    };
    // The helper runs elevated, so the pipe must explicitly permit a lower-integrity local client.
    // Remote clients are rejected, the name is random, and every control/data message has a token.
    let security_sddl = wide("D:P(A;;GA;;;WD)S:(ML;;NW;;;LW)");
    let mut security_descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            security_sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut security_descriptor,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(format!(
            "创建应用流量通信管道安全描述符失败：{}",
            std::io::Error::last_os_error()
        ));
    }
    let security_attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: security_descriptor,
        bInheritHandle: 0,
    };
    let handle = unsafe {
        CreateNamedPipeW(
            name.as_ptr(),
            open_mode,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            64 * 1024,
            64 * 1024,
            5_000,
            &security_attributes,
        )
    };
    let create_error = (handle == INVALID_HANDLE_VALUE).then(std::io::Error::last_os_error);
    unsafe {
        LocalFree(security_descriptor as _);
    }
    if handle == INVALID_HANDLE_VALUE {
        return Err(format!(
            "创建应用流量通信管道失败：{}",
            create_error.expect("invalid pipe handle must retain the Windows error")
        ));
    }
    Ok(handle as isize)
}

#[cfg(windows)]
fn wait_for_pipe_client(pipe_handle: isize, timeout: std::time::Duration) -> Result<(), String> {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_PIPE_CONNECTED},
        System::{
            Pipes::ConnectNamedPipe,
            Threading::{GetCurrentThreadId, OpenThread, THREAD_TERMINATE},
            IO::CancelSynchronousIo,
        },
    };

    let finished = Arc::new(AtomicBool::new(false));
    let watchdog_finished = Arc::clone(&finished);
    let thread_id = unsafe { GetCurrentThreadId() };
    std::thread::Builder::new()
        .name("haruha-traffic-pipe-timeout".to_string())
        .spawn(move || {
            std::thread::sleep(timeout);
            if watchdog_finished.load(Ordering::Acquire) {
                return;
            }
            let thread = unsafe { OpenThread(THREAD_TERMINATE, 0, thread_id) };
            if !thread.is_null() {
                unsafe {
                    CancelSynchronousIo(thread);
                    CloseHandle(thread);
                }
            }
        })
        .map_err(|error| format!("启动应用流量管道超时线程失败：{error}"))?;

    let connected = unsafe { ConnectNamedPipe(pipe_handle as _, std::ptr::null_mut()) } != 0
        || unsafe { GetLastError() } == ERROR_PIPE_CONNECTED;
    finished.store(true, Ordering::Release);
    if connected {
        Ok(())
    } else {
        Err(format!(
            "等待Haruha连接应用流量通信管道失败或超时：{}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(windows)]
fn launch_elevated_helper(
    data_pipe_name: &str,
    control_pipe_name: &str,
    token: &str,
) -> Result<(), String> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_HIDE};

    let executable =
        std::env::current_exe().map_err(|error| format!("无法定位应用流量采集程序：{error}"))?;
    let verb = wide("runas");
    let file = wide(executable.as_os_str().to_string_lossy().as_ref());
    let parameters = wide(&format!(
        "--traffic-helper --data-pipe \"{data_pipe_name}\" --control-pipe \"{control_pipe_name}\" --token \"{token}\""
    ));
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            parameters.as_ptr(),
            std::ptr::null(),
            SW_HIDE,
        )
    };
    if result as isize <= 32 {
        return Err(if result as isize == 5 {
            "已取消应用流量监控的管理员授权".to_string()
        } else {
            format!("启动应用流量采集器失败，Shell错误码：{}", result as isize)
        });
    }
    Ok(())
}

#[cfg(windows)]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperApplicationUsage {
    id: String,
    name: String,
    path: Option<String>,
    process_count: u32,
    download_bytes: u64,
    upload_bytes: u64,
}

#[cfg(windows)]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperMessage {
    token: String,
    run_id: u64,
    status: String,
    updated_at_ms: u64,
    applications: Vec<HelperApplicationUsage>,
    error: Option<String>,
}

#[cfg(windows)]
fn run_pipe_client(
    data_pipe_name: &str,
    control_pipe_name: &str,
    generation: u64,
    initial_run_id: u64,
    token: String,
    inner: Arc<Mutex<MonitorState>>,
) {
    use std::io::{BufRead, BufReader, Write};

    let pipe = match connect_to_pipe(data_pipe_name, TrafficPipeKind::Data) {
        Ok(pipe) => pipe,
        Err(error) => {
            mark_pipe_error(&inner, generation, &error);
            return;
        }
    };
    let mut control = match connect_to_pipe(control_pipe_name, TrafficPipeKind::Control) {
        Ok(control) => Some(control),
        Err(error) => {
            mark_pipe_error(&inner, generation, &error);
            return;
        }
    };

    let should_continue = if let Ok(mut state) = inner.lock() {
        if state.generation != generation || state.run_id != initial_run_id || state.token != token
        {
            false
        } else {
            let command_result = control.as_mut().map(|control| {
                control
                    .write_all(format!("start {token} {initial_run_id}\n").as_bytes())
                    .and_then(|_| control.flush())
            });
            if matches!(command_result, Some(Ok(()))) {
                state.control = control.take();
                true
            } else {
                false
            }
        }
    } else {
        false
    };
    if !should_continue {
        if let Some(mut control) = control {
            let _ = control.write_all(format!("shutdown {token}\n").as_bytes());
            let _ = control.flush();
        }
        return;
    }

    let mut reader = BufReader::new(pipe);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let Ok(message) = serde_json::from_str::<HelperMessage>(line.trim_end()) else {
                    continue;
                };
                if message.token != token {
                    continue;
                }
                apply_helper_message(&inner, generation, message);
            }
            Err(_) => break,
        }
    }

    if let Ok(mut state) = inner.lock() {
        if state.generation == generation {
            state.control = None;
            state.token.clear();
            state.last_message_received_at = None;
            if matches!(
                state.snapshot.status.as_str(),
                STATUS_STARTING | STATUS_RUNNING
            ) {
                state.snapshot.status = STATUS_ERROR.to_string();
                state.snapshot.error = Some("应用流量采集器已停止".to_string());
                state.snapshot.updated_at_ms = now_ms();
                state.snapshot.applications.clear();
                state.application_paths.clear();
            }
        }
    }
}

#[cfg(windows)]
fn apply_helper_message(inner: &Arc<Mutex<MonitorState>>, generation: u64, message: HelperMessage) {
    let Ok(mut state) = inner.lock() else {
        return;
    };
    if state.generation != generation
        || state.run_id != message.run_id
        || state.token != message.token
    {
        return;
    }

    let mut applications = message
        .applications
        .into_iter()
        .map(|application| {
            if let Some(path) = application.path {
                state.application_paths.insert(application.id.clone(), path);
            }
            let total_bytes = application
                .download_bytes
                .saturating_add(application.upload_bytes);
            TrafficApplicationUsage {
                id: application.id,
                name: application.name,
                process_count: application.process_count,
                download_bytes: application.download_bytes,
                upload_bytes: application.upload_bytes,
                total_bytes,
            }
        })
        .filter(|application| application.total_bytes > 0)
        .collect::<Vec<_>>();
    applications.sort_by(|left, right| {
        right
            .total_bytes
            .cmp(&left.total_bytes)
            .then_with(|| left.name.cmp(&right.name))
    });

    state.snapshot.status = message.status;
    state.snapshot.updated_at_ms = message.updated_at_ms;
    state.snapshot.applications = applications;
    state.snapshot.error = message.error;
    state.last_message_received_at = Some(std::time::Instant::now());
}

#[cfg(windows)]
fn mark_pipe_error(inner: &Arc<Mutex<MonitorState>>, generation: u64, message: &str) {
    if let Ok(mut state) = inner.lock() {
        if state.generation == generation {
            state.snapshot.status = STATUS_ERROR.to_string();
            state.snapshot.updated_at_ms = now_ms();
            state.snapshot.error = Some(message.to_string());
            state.snapshot.applications.clear();
            state.application_paths.clear();
            state.control = None;
            state.last_message_received_at = None;
        }
    }
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrafficDirection {
    Download,
    Upload,
}

#[cfg(windows)]
fn direction_for_network_opcode(opcode: u16) -> Option<TrafficDirection> {
    match opcode {
        10 | 26 | 42 | 58 => Some(TrafficDirection::Upload),
        11 | 27 | 43 | 59 => Some(TrafficDirection::Download),
        _ => None,
    }
}

#[cfg(windows)]
#[derive(Debug, Clone)]
struct ProcessIdentity {
    id: String,
    name: String,
    path: Option<String>,
    started_at_100ns: Option<u64>,
}

#[cfg(windows)]
struct ApplicationNameEnrichmentRequest {
    identity: ProcessIdentity,
    collector: std::sync::Weak<Mutex<CollectorState>>,
}

#[cfg(windows)]
enum CachedRecordResult {
    MissingProcess,
    Recorded {
        identity_to_enrich: Option<ProcessIdentity>,
    },
}

#[cfg(windows)]
#[derive(Debug, Default)]
struct ApplicationAccumulator {
    name: String,
    path: Option<String>,
    name_enrichment_settled: bool,
    download_bytes: u64,
    upload_bytes: u64,
    active_pids: std::collections::HashSet<u32>,
}

#[cfg(windows)]
impl ApplicationAccumulator {
    fn record_bytes(&mut self, size: u64, direction: TrafficDirection) {
        match direction {
            TrafficDirection::Download => {
                self.download_bytes = self.download_bytes.saturating_add(size)
            }
            TrafficDirection::Upload => self.upload_bytes = self.upload_bytes.saturating_add(size),
        }
    }
}

#[cfg(windows)]
#[derive(Debug, Default)]
struct CollectorState {
    processes: HashMap<u32, ProcessIdentity>,
    applications: HashMap<String, ApplicationAccumulator>,
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileVersionFingerprint {
    length: u64,
    modified_at_nanos: u128,
}

#[cfg(windows)]
#[derive(Debug, Clone)]
struct ApplicationNameCacheEntry {
    fingerprint: FileVersionFingerprint,
    name: Option<String>,
}

#[cfg(windows)]
#[derive(Debug, Default)]
struct ApplicationNameCache {
    entries: HashMap<String, ApplicationNameCacheEntry>,
    insertion_order: std::collections::VecDeque<String>,
}

#[cfg(windows)]
#[derive(Debug, Default)]
struct CollectorDiagnostics {
    callback_events: std::sync::atomic::AtomicU64,
    data_events: std::sync::atomic::AtomicU64,
    unsupported_opcodes: std::sync::atomic::AtomicU64,
    schema_failures: std::sync::atomic::AtomicU64,
    size_failures: std::sync::atomic::AtomicU64,
    address_failures: std::sync::atomic::AtomicU64,
    loopback_events: std::sync::atomic::AtomicU64,
    recorded_events: std::sync::atomic::AtomicU64,
}

#[cfg(windows)]
impl CollectorDiagnostics {
    fn increment(counter: &std::sync::atomic::AtomicU64) {
        counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    fn parsing_error(&self) -> Option<String> {
        use std::sync::atomic::Ordering;

        let data_events = self.data_events.load(Ordering::Relaxed);
        let recorded_events = self.recorded_events.load(Ordering::Relaxed);
        let loopback_events = self.loopback_events.load(Ordering::Relaxed);
        let schema_failures = self.schema_failures.load(Ordering::Relaxed);
        let size_failures = self.size_failures.load(Ordering::Relaxed);
        let address_failures = self.address_failures.load(Ordering::Relaxed);
        let parse_failures = schema_failures
            .saturating_add(size_failures)
            .saturating_add(address_failures);

        (data_events >= 10 && recorded_events == 0 && parse_failures > 0).then(|| {
            format!(
                "Windows网络事件无法解析（事件 {data_events}，结构失败 {schema_failures}，字节失败 {size_failures}，地址失败 {address_failures}，回环 {loopback_events}）"
            )
        })
    }

    fn event_pipeline_summary(&self) -> String {
        use std::sync::atomic::Ordering;

        let callback_events = self.callback_events.load(Ordering::Relaxed);
        let data_events = self.data_events.load(Ordering::Relaxed);
        let unsupported_opcodes = self.unsupported_opcodes.load(Ordering::Relaxed);
        let recorded_events = self.recorded_events.load(Ordering::Relaxed);
        let loopback_events = self.loopback_events.load(Ordering::Relaxed);
        let schema_failures = self.schema_failures.load(Ordering::Relaxed);
        let size_failures = self.size_failures.load(Ordering::Relaxed);
        let address_failures = self.address_failures.load(Ordering::Relaxed);

        format!(
            "网络回调 {callback_events}，数据事件 {data_events}，未识别操作 {unsupported_opcodes}，已记录 {recorded_events}，回环 {loopback_events}，结构失败 {schema_failures}，字节失败 {size_failures}，地址失败 {address_failures}"
        )
    }

    fn empty_collection_error(&self) -> String {
        format!(
            "系统网卡已有流量，但Windows事件未形成应用统计（{}）",
            self.event_pipeline_summary()
        )
    }

    fn empty_collection_diagnostic(&self) -> String {
        format!("尚未形成应用统计（{}）", self.event_pipeline_summary())
    }
}

#[cfg(windows)]
impl CollectorState {
    fn process_started(&mut self, pid: u32, identity: ProcessIdentity) {
        self.attach_process(pid, identity);
    }

    fn process_exited(&mut self, pid: u32) {
        self.detach_pid(pid);
    }

    #[cfg(test)]
    fn record_cached(
        &mut self,
        pid: u32,
        size: u64,
        direction: TrafficDirection,
    ) -> CachedRecordResult {
        self.record_cached_at(pid, size, direction, None)
    }

    fn record_cached_at(
        &mut self,
        pid: u32,
        size: u64,
        direction: TrafficDirection,
        event_timestamp_100ns: Option<u64>,
    ) -> CachedRecordResult {
        let Some(identity) = self.processes.get(&pid) else {
            return CachedRecordResult::MissingProcess;
        };
        // Process ETW events can expose only a basename (for example,
        // `python.exe`) while the process is still starting. Do not make that
        // incomplete identity permanent: the network event path can query the
        // live process again and obtain the executable path needed for icons.
        if identity.path.is_none() && identity.id != "system-unknown" {
            return CachedRecordResult::MissingProcess;
        }
        if event_timestamp_100ns
            .zip(identity.started_at_100ns)
            .is_some_and(|(event_at, process_started_at)| event_at < process_started_at)
        {
            self.record_unattributed(size, direction);
            return CachedRecordResult::Recorded {
                identity_to_enrich: None,
            };
        }
        if let Some(application) = self.applications.get_mut(&identity.id) {
            application.record_bytes(size, direction);
            let identity_to_enrich = if application.name_enrichment_settled {
                None
            } else {
                application.name_enrichment_settled = true;
                Some(identity.clone())
            };
            return CachedRecordResult::Recorded { identity_to_enrich };
        }

        let should_enrich = should_enrich_application_name(identity);
        let identity_to_enrich = should_enrich.then(|| identity.clone());
        let mut application = ApplicationAccumulator {
            name: identity.name.clone(),
            path: identity.path.clone(),
            name_enrichment_settled: true,
            ..ApplicationAccumulator::default()
        };
        application.active_pids.insert(pid);
        application.record_bytes(size, direction);
        self.applications.insert(identity.id.clone(), application);
        CachedRecordResult::Recorded { identity_to_enrich }
    }

    #[cfg(test)]
    fn record_resolved(
        &mut self,
        pid: u32,
        identity: ProcessIdentity,
        size: u64,
        direction: TrafficDirection,
    ) -> Option<ProcessIdentity> {
        if !self.processes.contains_key(&pid) {
            self.attach_process(pid, identity);
        }
        match self.record_cached(pid, size, direction) {
            CachedRecordResult::Recorded { identity_to_enrich } => identity_to_enrich,
            CachedRecordResult::MissingProcess => {
                debug_assert!(false, "resolved process was not cached");
                None
            }
        }
    }

    fn record_resolved_at(
        &mut self,
        pid: u32,
        identity: ProcessIdentity,
        size: u64,
        direction: TrafficDirection,
        event_timestamp_100ns: Option<u64>,
    ) -> Option<ProcessIdentity> {
        // This method is reached after the cache reported a missing or
        // incomplete identity, so the fresh process query is authoritative.
        self.attach_process(pid, identity);
        match self.record_cached_at(pid, size, direction, event_timestamp_100ns) {
            CachedRecordResult::Recorded { identity_to_enrich } => identity_to_enrich,
            CachedRecordResult::MissingProcess => {
                debug_assert!(false, "resolved process was not cached");
                None
            }
        }
    }

    fn record_unattributed(&mut self, size: u64, direction: TrafficDirection) {
        let identity = unknown_identity();
        self.applications
            .entry(identity.id)
            .or_insert_with(|| ApplicationAccumulator {
                name: identity.name,
                path: None,
                name_enrichment_settled: true,
                ..ApplicationAccumulator::default()
            })
            .record_bytes(size, direction);
    }

    fn update_identity_name(&mut self, application_id: &str, name: &str) {
        for identity in self
            .processes
            .values_mut()
            .filter(|identity| identity.id == application_id)
        {
            name.clone_into(&mut identity.name);
        }
        if let Some(application) = self.applications.get_mut(application_id) {
            name.clone_into(&mut application.name);
        }
    }

    fn retry_identity_name_enrichment(&mut self, application_id: &str) {
        if let Some(application) = self.applications.get_mut(application_id) {
            application.name_enrichment_settled = false;
        }
    }

    fn detach_pid(&mut self, pid: u32) {
        if let Some(identity) = self.processes.remove(&pid) {
            if let Some(application) = self.applications.get_mut(&identity.id) {
                application.active_pids.remove(&pid);
            }
        }
    }

    fn attach_process(&mut self, pid: u32, identity: ProcessIdentity) {
        self.detach_pid(pid);
        if let Some(application) = self.applications.get_mut(&identity.id) {
            application.active_pids.insert(pid);
        }
        self.processes.insert(pid, identity);
    }

    fn snapshot(&self) -> Vec<HelperApplicationUsage> {
        let mut applications = self
            .applications
            .iter()
            .filter_map(|(id, accumulator)| {
                let total = accumulator
                    .download_bytes
                    .saturating_add(accumulator.upload_bytes);
                (total > 0).then(|| HelperApplicationUsage {
                    id: id.clone(),
                    name: accumulator.name.clone(),
                    path: accumulator.path.clone(),
                    process_count: accumulator.active_pids.len().min(u32::MAX as usize) as u32,
                    download_bytes: accumulator.download_bytes,
                    upload_bytes: accumulator.upload_bytes,
                })
            })
            .collect::<Vec<_>>();
        applications.sort_by(|left, right| {
            let left_total = left.download_bytes.saturating_add(left.upload_bytes);
            let right_total = right.download_bytes.saturating_add(right.upload_bytes);
            right_total
                .cmp(&left_total)
                .then_with(|| left.name.cmp(&right.name))
        });
        applications
    }
}

#[cfg(windows)]
fn identity_from_image_name(image_name: &str) -> Option<ProcessIdentity> {
    let trimmed = image_name.trim().trim_matches('\0');
    if trimmed.is_empty() {
        return None;
    }
    let path = std::path::Path::new(trimmed);
    let file_name = path.file_name()?.to_string_lossy().into_owned();
    let name = application_display_name(&file_name);
    let normalized = trimmed.replace('/', "\\").to_lowercase();
    let id_source = if path.is_absolute() {
        normalized.clone()
    } else {
        format!("image:{normalized}")
    };
    Some(ProcessIdentity {
        id: application_id(&id_source),
        name,
        path: path.is_absolute().then(|| trimmed.to_string()),
        started_at_100ns: None,
    })
}

#[cfg(windows)]
fn unknown_identity() -> ProcessIdentity {
    ProcessIdentity {
        id: "system-unknown".to_string(),
        name: "系统/未知".to_string(),
        path: None,
        started_at_100ns: None,
    }
}

#[cfg(windows)]
fn resolve_process_identity(pid: u32) -> Option<ProcessIdentity> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME},
        System::Threading::{
            GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
    };

    if pid == 0 || pid == 4 {
        return None;
    }
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return None;
    }
    let mut creation_time = FILETIME::default();
    let mut exit_time = FILETIME::default();
    let mut kernel_time = FILETIME::default();
    let mut user_time = FILETIME::default();
    let started_at_100ns = (unsafe {
        GetProcessTimes(
            process,
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        )
    } != 0)
        .then(|| {
            ((creation_time.dwHighDateTime as u64) << 32) | creation_time.dwLowDateTime as u64
        });
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let result =
        unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) };
    unsafe {
        CloseHandle(process);
    }
    if result == 0 || length == 0 {
        return None;
    }
    let path = String::from_utf16_lossy(&buffer[..length as usize]);
    let file_name = std::path::Path::new(&path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())?;
    Some(ProcessIdentity {
        id: application_id(&path.to_lowercase()),
        name: application_display_name(&file_name),
        path: Some(path),
        started_at_100ns,
    })
}

#[cfg(windows)]
fn application_display_name(file_name: &str) -> String {
    if let Some(name) = mapped_application_display_name(file_name) {
        return name.to_string();
    }
    application_file_stem(file_name).to_string()
}

#[cfg(windows)]
fn application_file_stem(file_name: &str) -> &str {
    file_name
        .strip_suffix(".exe")
        .or_else(|| file_name.strip_suffix(".EXE"))
        .unwrap_or(file_name)
}

#[cfg(windows)]
fn mapped_application_display_name(file_name: &str) -> Option<&'static str> {
    let stem = application_file_stem(file_name);
    match stem.to_ascii_lowercase().as_str() {
        "proxy-manager-next" | "haruha" => Some("Haruha"),
        "chrome" => Some("Google Chrome"),
        "msedge" => Some("Microsoft Edge"),
        "firefox" => Some("Firefox"),
        "code" => Some("Visual Studio Code"),
        "wechat" | "wechatapp" => Some("微信"),
        "qq" => Some("QQ"),
        "system" => Some("系统"),
        _ => None,
    }
}

#[cfg(windows)]
fn application_display_name_with_metadata(
    file_name: &str,
    metadata_name: Option<String>,
) -> String {
    if let Some(name) = mapped_application_display_name(file_name) {
        return name.to_string();
    }
    metadata_name.unwrap_or_else(|| application_file_stem(file_name).to_string())
}

#[cfg(windows)]
fn application_display_name_for_path(path: &str, file_name: &str) -> String {
    if let Some(name) = mapped_application_display_name(file_name) {
        return name.to_string();
    }
    application_display_name_with_metadata(file_name, cached_file_version_display_name(path))
}

#[cfg(windows)]
fn should_enrich_application_name(identity: &ProcessIdentity) -> bool {
    let Some(path) = identity.path.as_deref() else {
        return false;
    };
    let Some(file_name) = std::path::Path::new(path).file_name() else {
        return false;
    };
    mapped_application_display_name(&file_name.to_string_lossy()).is_none()
}

#[cfg(windows)]
fn queue_application_name_enrichment(
    sender: &std::sync::mpsc::SyncSender<ApplicationNameEnrichmentRequest>,
    collector: &Arc<Mutex<CollectorState>>,
    identity: ProcessIdentity,
) {
    let request = ApplicationNameEnrichmentRequest {
        identity,
        collector: Arc::downgrade(collector),
    };
    match sender.try_send(request) {
        Ok(()) | Err(std::sync::mpsc::TrySendError::Disconnected(_)) => {}
        Err(std::sync::mpsc::TrySendError::Full(request)) => {
            if let Some(collector) = request.collector.upgrade() {
                if let Ok(mut state) = collector.lock() {
                    state.retry_identity_name_enrichment(&request.identity.id);
                }
            }
        }
    }
}

#[cfg(windows)]
fn run_application_name_enricher(
    receiver: std::sync::mpsc::Receiver<ApplicationNameEnrichmentRequest>,
) {
    while let Ok(request) = receiver.recv() {
        if request.collector.strong_count() == 0 {
            continue;
        }
        let identity = request.identity;
        let Some(path) = identity.path.as_deref() else {
            continue;
        };
        let Some(file_name) = std::path::Path::new(path).file_name() else {
            continue;
        };
        let name = application_display_name_for_path(path, &file_name.to_string_lossy());
        if name == identity.name {
            continue;
        }
        if let Some(collector) = request.collector.upgrade() {
            if let Ok(mut state) = collector.lock() {
                state.update_identity_name(&identity.id, &name);
            }
        }
    }
}

#[cfg(windows)]
fn stop_application_name_enricher(
    thread: std::thread::JoinHandle<()>,
    finished: std::sync::mpsc::Receiver<()>,
) {
    if finished
        .recv_timeout(std::time::Duration::from_millis(500))
        .is_ok()
    {
        let _ = thread.join();
    }
    // A blocked worker is detached only when the helper itself is exiting. There
    // is one worker per helper process (not one per monitoring generation), and
    // each request carries a Weak collector, so it cannot retain or mutate an old
    // generation after Stop/Restart.
}

#[cfg(windows)]
fn cached_file_version_display_name(path: &str) -> Option<String> {
    static CACHE: std::sync::OnceLock<Mutex<ApplicationNameCache>> = std::sync::OnceLock::new();

    if !is_local_version_info_path(path) {
        return None;
    }
    let Some(fingerprint) = file_version_fingerprint(path) else {
        return file_version_display_name(path);
    };
    let cache = CACHE.get_or_init(|| Mutex::new(ApplicationNameCache::default()));
    let key = path.replace('/', "\\").to_lowercase();
    if let Ok(cache) = cache.lock() {
        if let Some(entry) = cache.entries.get(&key) {
            if entry.fingerprint == fingerprint {
                return entry.name.clone();
            }
        }
    }

    let name = file_version_display_name(path);
    if let Ok(mut cache) = cache.lock() {
        cache.entries.remove(&key);
        cache.insertion_order.retain(|existing| existing != &key);
        while cache.entries.len() >= APPLICATION_NAME_CACHE_LIMIT {
            let Some(oldest) = cache.insertion_order.pop_front() else {
                break;
            };
            cache.entries.remove(&oldest);
        }
        cache.insertion_order.push_back(key.clone());
        cache.entries.insert(
            key,
            ApplicationNameCacheEntry {
                fingerprint,
                name: name.clone(),
            },
        );
    }
    name
}

#[cfg(windows)]
fn is_local_version_info_path(path: &str) -> bool {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

    let bytes = path.as_bytes();
    if bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || !matches!(bytes[2], b'\\' | b'/')
    {
        return false;
    }
    let root = format!("{}:\\", bytes[0] as char);
    let wide_root = OsStr::new(&root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // Restrict version-resource reads to fixed local drives. Removable media,
    // optical drives and network shares can block indefinitely when unavailable.
    (unsafe { GetDriveTypeW(wide_root.as_ptr()) }) == 3
}

#[cfg(windows)]
fn file_version_fingerprint(path: &str) -> Option<FileVersionFingerprint> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified_at_nanos = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some(FileVersionFingerprint {
        length: metadata.len(),
        modified_at_nanos,
    })
}

#[cfg(windows)]
fn file_version_display_name(path: &str) -> Option<String> {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };

    let wide_path = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let size = unsafe { GetFileVersionInfoSizeW(wide_path.as_ptr(), std::ptr::null_mut()) };
    if size == 0 || size > MAX_VERSION_INFO_BYTES {
        return None;
    }

    let mut version_info = vec![0_u8; size as usize];
    if unsafe {
        GetFileVersionInfoW(
            wide_path.as_ptr(),
            0,
            size,
            version_info.as_mut_ptr().cast(),
        )
    } == 0
    {
        return None;
    }

    let translation_query = "\\VarFileInfo\\Translation\0"
        .encode_utf16()
        .collect::<Vec<_>>();
    let mut translation_ptr = std::ptr::null_mut();
    let mut translation_bytes = 0_u32;
    let mut translations = Vec::new();
    if unsafe {
        VerQueryValueW(
            version_info.as_ptr().cast(),
            translation_query.as_ptr(),
            &mut translation_ptr,
            &mut translation_bytes,
        )
    } != 0
        && !translation_ptr.is_null()
        && translation_bytes >= 4
    {
        let base = version_info.as_ptr() as usize;
        let end = base.checked_add(version_info.len())?;
        let start = translation_ptr as usize;
        let translation_end = start.checked_add(translation_bytes as usize)?;
        if start >= base && translation_end <= end {
            let offset = start.checked_sub(base)?;
            let bytes = version_info.get(offset..offset + translation_bytes as usize)?;
            translations.extend(bytes.chunks_exact(4).map(|translation| {
                (
                    u16::from_le_bytes([translation[0], translation[1]]),
                    u16::from_le_bytes([translation[2], translation[3]]),
                )
            }));
        }
    }

    for fallback in [
        (0x0804, 0x04b0),
        (0x0409, 0x04b0),
        (0x0000, 0x04b0),
        (0x0400, 0x04b0),
        (0x0804, 0x04e4),
        (0x0409, 0x04e4),
        (0x0000, 0x04e4),
        (0x0400, 0x04e4),
    ] {
        if !translations.contains(&fallback) {
            translations.push(fallback);
        }
    }

    // FileDescription is usually the user-facing executable name, while
    // ProductName can be a broad suite or OS label shared by unrelated tools.
    for key in ["FileDescription", "ProductName"] {
        for (language, code_page) in &translations {
            let query = format!("\\StringFileInfo\\{language:04X}{code_page:04X}\\{key}\0")
                .encode_utf16()
                .collect::<Vec<_>>();
            let mut value_ptr = std::ptr::null_mut();
            let mut value_chars = 0_u32;
            if unsafe {
                VerQueryValueW(
                    version_info.as_ptr().cast(),
                    query.as_ptr(),
                    &mut value_ptr,
                    &mut value_chars,
                )
            } == 0
                || value_ptr.is_null()
                || value_chars == 0
                || value_chars > MAX_APPLICATION_NAME_UTF16_UNITS
            {
                continue;
            }

            let value_bytes = (value_chars as usize).checked_mul(std::mem::size_of::<u16>())?;
            let base = version_info.as_ptr() as usize;
            let end = base.checked_add(version_info.len())?;
            let start = value_ptr as usize;
            let value_end = start.checked_add(value_bytes)?;
            if start < base || value_end > end {
                continue;
            }
            let Some(offset) = start.checked_sub(base) else {
                continue;
            };
            let Some(value) = version_info.get(offset..offset + value_bytes) else {
                continue;
            };
            let value = value
                .chunks_exact(2)
                .map(|character| u16::from_le_bytes([character[0], character[1]]))
                .collect::<Vec<_>>();
            let value_length = value
                .iter()
                .position(|character| *character == 0)
                .unwrap_or(value.len());
            let value = String::from_utf16_lossy(&value[..value_length]);
            let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
            if !normalized.is_empty() && normalized.chars().count() <= 160 {
                return Some(normalized);
            }
        }
    }
    None
}

#[cfg(windows)]
fn application_id(identity: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    identity.hash(&mut hasher);
    format!("app-{:016x}", hasher.finish())
}

#[cfg(windows)]
fn is_loopback_event(source: std::net::IpAddr, destination: std::net::IpAddr) -> bool {
    source.is_loopback() || destination.is_loopback()
}

#[cfg(windows)]
fn collect_network_event(
    record: &ferrisetw::EventRecord,
    locator: &ferrisetw::SchemaLocator,
    collector: &Arc<Mutex<CollectorState>>,
    diagnostics: &CollectorDiagnostics,
    identity_enrichment: &std::sync::mpsc::SyncSender<ApplicationNameEnrichmentRequest>,
) {
    use ferrisetw::parser::Parser;

    CollectorDiagnostics::increment(&diagnostics.callback_events);
    let Some(direction) = direction_for_network_opcode(record.opcode() as u16) else {
        CollectorDiagnostics::increment(&diagnostics.unsupported_opcodes);
        return;
    };
    CollectorDiagnostics::increment(&diagnostics.data_events);
    let schema = match locator.event_schema(record) {
        Ok(schema) => schema,
        Err(_) => {
            CollectorDiagnostics::increment(&diagnostics.schema_failures);
            return;
        }
    };
    let parser = Parser::create(record, &schema);
    let pid = parser
        .try_parse::<u32>("PID")
        .or_else(|_| parser.try_parse::<u32>("ProcessId"))
        .unwrap_or(record.process_id());
    let size = match parser.try_parse::<u32>("size") {
        Ok(size) if size > 0 => size as u64,
        _ => {
            CollectorDiagnostics::increment(&diagnostics.size_failures);
            return;
        }
    };
    let (source, destination) = match (
        parser.try_parse::<std::net::IpAddr>("saddr"),
        parser.try_parse::<std::net::IpAddr>("daddr"),
    ) {
        (Ok(source), Ok(destination)) => (source, destination),
        _ => {
            CollectorDiagnostics::increment(&diagnostics.address_failures);
            return;
        }
    };
    if is_loopback_event(source, destination) {
        CollectorDiagnostics::increment(&diagnostics.loopback_events);
        return;
    }
    let event_timestamp_100ns = u64::try_from(record.raw_timestamp()).ok();
    let cached_result = collector
        .lock()
        .map(|mut state| state.record_cached_at(pid, size, direction, event_timestamp_100ns))
        .unwrap_or(CachedRecordResult::MissingProcess);
    if let CachedRecordResult::Recorded { identity_to_enrich } = cached_result {
        CollectorDiagnostics::increment(&diagnostics.recorded_events);
        if let Some(identity) = identity_to_enrich {
            queue_application_name_enrichment(identity_enrichment, collector, identity);
        }
        return;
    }

    // Querying a new PID can touch process state. Keep it outside the aggregation
    // lock, and leave the slower executable metadata lookup to the name worker.
    let resolved_identity = resolve_process_identity(pid).unwrap_or_else(unknown_identity);
    let identity_to_enrich = if let Ok(mut state) = collector.lock() {
        let identity_to_enrich = state.record_resolved_at(
            pid,
            resolved_identity,
            size,
            direction,
            event_timestamp_100ns,
        );
        CollectorDiagnostics::increment(&diagnostics.recorded_events);
        identity_to_enrich
    } else {
        None
    };
    if let Some(identity) = identity_to_enrich {
        queue_application_name_enrichment(identity_enrichment, collector, identity);
    }
}

#[cfg(windows)]
fn collector_snapshot_with_timeout(
    collector: &Arc<Mutex<CollectorState>>,
    timeout: std::time::Duration,
) -> Result<Vec<HelperApplicationUsage>, String> {
    let started = std::time::Instant::now();
    loop {
        match collector.try_lock() {
            Ok(state) => return Ok(state.snapshot()),
            Err(std::sync::TryLockError::Poisoned(_)) => {
                return Err("应用流量聚合状态锁已损坏".to_string())
            }
            Err(std::sync::TryLockError::WouldBlock) if started.elapsed() >= timeout => {
                return Err(format!(
                    "应用流量聚合持续繁忙，{}毫秒内无法生成快照",
                    timeout.as_millis()
                ))
            }
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        }
    }
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HelperCommand {
    Start(u64),
    Stop(u64),
    Shutdown,
    Disconnected,
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CollectorExit {
    Stopped,
    Restart(u64),
    Shutdown,
}

#[cfg(windows)]
fn parse_helper_command(command: &str, expected_token: &str) -> Option<HelperCommand> {
    let mut parts = command.split_whitespace();
    let action = parts.next()?;
    let token = parts.next()?;
    if token != expected_token {
        return None;
    }
    match action {
        "start" => parts
            .next()
            .and_then(|run_id| run_id.parse().ok())
            .map(HelperCommand::Start),
        "stop" => parts
            .next()
            .and_then(|run_id| run_id.parse().ok())
            .map(HelperCommand::Stop),
        "shutdown" => Some(HelperCommand::Shutdown),
        _ => None,
    }
}

#[cfg(windows)]
fn run_elevated_helper(
    data_pipe_name: &str,
    control_pipe_name: &str,
    token: &str,
) -> Result<(), String> {
    use std::{
        io::{BufRead, BufReader},
        os::windows::io::FromRawHandle,
        time::Duration,
    };
    use windows_sys::Win32::Foundation::CloseHandle;

    let data_pipe_handle = create_pipe_server(data_pipe_name, TrafficPipeKind::Data)?;
    let control_pipe_handle = match create_pipe_server(control_pipe_name, TrafficPipeKind::Control)
    {
        Ok(handle) => handle,
        Err(error) => {
            unsafe {
                CloseHandle(data_pipe_handle as _);
            }
            return Err(error);
        }
    };
    if let Err(error) = wait_for_pipe_client(data_pipe_handle, Duration::from_secs(20)) {
        unsafe {
            CloseHandle(data_pipe_handle as _);
            CloseHandle(control_pipe_handle as _);
        }
        return Err(error);
    }
    if let Err(error) = wait_for_pipe_client(control_pipe_handle, Duration::from_secs(20)) {
        unsafe {
            CloseHandle(data_pipe_handle as _);
            CloseHandle(control_pipe_handle as _);
        }
        return Err(error);
    }
    let pipe = unsafe { std::fs::File::from_raw_handle(data_pipe_handle as _) };
    let control_pipe = unsafe { std::fs::File::from_raw_handle(control_pipe_handle as _) };
    let (command_tx, command_rx) = std::sync::mpsc::channel();
    let expected_token = token.to_string();
    std::thread::Builder::new()
        .name("haruha-traffic-control".to_string())
        .spawn(move || {
            let mut reader = BufReader::new(control_pipe);
            let mut command = String::new();
            loop {
                command.clear();
                match reader.read_line(&mut command) {
                    Ok(0) | Err(_) => {
                        let _ = command_tx.send(HelperCommand::Disconnected);
                        break;
                    }
                    Ok(_) => {
                        if let Some(command) = parse_helper_command(command.trim(), &expected_token)
                        {
                            let should_exit = command == HelperCommand::Shutdown;
                            if command_tx.send(command).is_err() || should_exit {
                                break;
                            }
                        }
                    }
                }
            }
        })
        .map_err(|error| format!("启动应用流量控制线程失败：{error}"))?;

    let (identity_enrichment_tx, identity_enrichment_rx) =
        std::sync::mpsc::sync_channel(APPLICATION_NAME_ENRICHMENT_QUEUE_LIMIT);
    let (identity_enrichment_finished_tx, identity_enrichment_finished_rx) =
        std::sync::mpsc::channel();
    let identity_enrichment_thread = std::thread::Builder::new()
        .name("haruha-traffic-app-names".to_string())
        .spawn(move || {
            run_application_name_enricher(identity_enrichment_rx);
            let _ = identity_enrichment_finished_tx.send(());
        })
        .map_err(|error| format!("启动应用名称识别线程失败：{error}"))?;

    let mut pipe = pipe;
    let mut pending_command = None;
    loop {
        let command = match pending_command.take() {
            Some(command) => command,
            None => match command_rx.recv() {
                Ok(command) => command,
                Err(_) => HelperCommand::Disconnected,
            },
        };
        match command {
            HelperCommand::Start(run_id) => {
                match run_elevated_collection(
                    &mut pipe,
                    token,
                    run_id,
                    &command_rx,
                    &identity_enrichment_tx,
                ) {
                    Ok(CollectorExit::Stopped) => {}
                    Ok(CollectorExit::Restart(next_run_id)) => {
                        pending_command = Some(HelperCommand::Start(next_run_id));
                    }
                    Ok(CollectorExit::Shutdown) => break,
                    Err(error) => {
                        let _ = send_helper_message(
                            &mut pipe,
                            HelperMessage {
                                token: token.to_string(),
                                run_id,
                                status: STATUS_ERROR.to_string(),
                                updated_at_ms: now_ms(),
                                applications: Vec::new(),
                                error: Some(error),
                            },
                        );
                    }
                }
            }
            HelperCommand::Stop(_) => {}
            HelperCommand::Shutdown | HelperCommand::Disconnected => break,
        }
    }
    drop(identity_enrichment_tx);
    stop_application_name_enricher(identity_enrichment_thread, identity_enrichment_finished_rx);
    Ok(())
}

#[cfg(windows)]
fn run_elevated_collection(
    pipe: &mut std::fs::File,
    token: &str,
    run_id: u64,
    command_rx: &std::sync::mpsc::Receiver<HelperCommand>,
    identity_enrichment_tx: &std::sync::mpsc::SyncSender<ApplicationNameEnrichmentRequest>,
) -> Result<CollectorExit, String> {
    use ferrisetw::{
        parser::Parser,
        provider::{kernel_providers, Provider},
        schema_locator::SchemaLocator,
        trace::{KernelTrace, TraceTrait},
        EventRecord, GUID,
    };
    use std::time::{Duration, Instant};

    let collector = Arc::new(Mutex::new(CollectorState::default()));
    let diagnostics = Arc::new(CollectorDiagnostics::default());
    let interface_baseline = crate::platform::network_traffic_totals().ok();
    let tcp_collector = Arc::clone(&collector);
    let tcp_diagnostics = Arc::clone(&diagnostics);
    let tcp_identity_enrichment = identity_enrichment_tx.clone();
    let tcp_provider = Provider::kernel(&kernel_providers::TCP_IP_PROVIDER)
        .add_callback(move |record: &EventRecord, locator: &SchemaLocator| {
            collect_network_event(
                record,
                locator,
                &tcp_collector,
                &tcp_diagnostics,
                &tcp_identity_enrichment,
            );
        })
        .build();

    // EVENT_TRACE_FLAG_NETWORK_TCPIP also enables the classic UDP provider, which
    // has a distinct GUID and therefore needs its own callback registration.
    let udp_kernel_provider = kernel_providers::KernelProvider::new(
        GUID::from_values(
            0xbf3a50c5,
            0xa9c9,
            0x4988,
            [0xa0, 0x05, 0x2d, 0xf0, 0xb7, 0xc8, 0x0f, 0x80],
        ),
        0x0001_0000,
    );
    let udp_collector = Arc::clone(&collector);
    let udp_diagnostics = Arc::clone(&diagnostics);
    let udp_identity_enrichment = identity_enrichment_tx.clone();
    let udp_provider = Provider::kernel(&udp_kernel_provider)
        .add_callback(move |record: &EventRecord, locator: &SchemaLocator| {
            collect_network_event(
                record,
                locator,
                &udp_collector,
                &udp_diagnostics,
                &udp_identity_enrichment,
            );
        })
        .build();

    // Windows can surface EVENT_TRACE_FLAG_NETWORK_TCPIP events with either the
    // classic TCP/UDP GUIDs above or the manifest-based Kernel-Network GUID. The
    // ferrisetw dispatcher matches callbacks by GUID before invoking them, so
    // register the manifest GUID as a callback-only compatibility route while
    // the classic providers continue to supply the KernelTrace enable flags.
    let manifest_network_collector = Arc::clone(&collector);
    let manifest_network_diagnostics = Arc::clone(&diagnostics);
    let manifest_identity_enrichment = identity_enrichment_tx.clone();
    let manifest_network_provider = Provider::by_guid("7dd42a49-5329-4832-8dfd-43d979153a88")
        .add_callback(move |record: &EventRecord, locator: &SchemaLocator| {
            collect_network_event(
                record,
                locator,
                &manifest_network_collector,
                &manifest_network_diagnostics,
                &manifest_identity_enrichment,
            );
        })
        .build();

    let process_collector = Arc::clone(&collector);
    let process_provider = Provider::kernel(&kernel_providers::PROCESS_PROVIDER)
        .add_callback(move |record: &EventRecord, locator: &SchemaLocator| {
            if !matches!(record.opcode(), 1 | 2) {
                return;
            }
            let Ok(schema) = locator.event_schema(record) else {
                return;
            };
            let parser = Parser::create(record, &schema);
            let pid = parser
                .try_parse::<u32>("ProcessID")
                .or_else(|_| parser.try_parse::<u32>("ProcessId"))
                .unwrap_or(record.process_id());
            match record.opcode() {
                1 => {
                    let image_name = parser
                        .try_parse::<String>("ImageFileName")
                        .or_else(|_| parser.try_parse::<String>("ImageName"))
                        .unwrap_or_default();
                    let identity = resolve_process_identity(pid).unwrap_or_else(|| {
                        identity_from_image_name(&image_name).unwrap_or_else(unknown_identity)
                    });
                    if let Ok(mut state) = process_collector.lock() {
                        state.process_started(pid, identity);
                    }
                }
                2 => {
                    if let Ok(mut state) = process_collector.lock() {
                        state.process_exited(pid);
                    }
                }
                _ => {}
            }
        })
        .build();

    let trace_name = format!("HaruhaTraffic-{}-{}", std::process::id(), now_ms());
    let (traffic_trace, trace_handle) = match KernelTrace::new()
        .named(trace_name.clone())
        .enable(tcp_provider)
        .enable(udp_provider)
        .enable(manifest_network_provider)
        .enable(process_provider)
        .start()
    {
        Ok(trace) => trace,
        Err(error) => {
            let _ = send_helper_message(
                pipe,
                HelperMessage {
                    token: token.to_string(),
                    run_id,
                    status: STATUS_ERROR.to_string(),
                    updated_at_ms: now_ms(),
                    applications: Vec::new(),
                    error: Some(format!("启动Windows应用流量事件采集失败：{error:?}")),
                },
            );
            return Err(format!("启动Windows应用流量事件采集失败：{error:?}"));
        }
    };
    let (trace_result_tx, trace_result_rx) = std::sync::mpsc::channel();
    let trace_thread = match std::thread::Builder::new()
        .name("haruha-traffic-etw".to_string())
        .spawn(move || {
            let _ = trace_result_tx.send(KernelTrace::process_from_handle(trace_handle));
        }) {
        Ok(thread) => thread,
        Err(error) => {
            let _ = ferrisetw::trace::stop_trace_by_name(&trace_name);
            drop(traffic_trace);
            return Err(format!("启动Windows应用流量事件处理线程失败：{error}"));
        }
    };

    let mut last_snapshot = Instant::now();
    let trace_started = Instant::now();
    let monitor_result = (|| -> Result<CollectorExit, String> {
        send_helper_message(
            pipe,
            HelperMessage {
                token: token.to_string(),
                run_id,
                status: STATUS_RUNNING.to_string(),
                updated_at_ms: now_ms(),
                applications: Vec::new(),
                error: None,
            },
        )?;
        loop {
            std::thread::sleep(Duration::from_millis(250));
            match command_rx.try_recv() {
                Ok(HelperCommand::Stop(command_run_id)) if command_run_id == run_id => {
                    return Ok(CollectorExit::Stopped)
                }
                Ok(HelperCommand::Start(next_run_id)) if next_run_id != run_id => {
                    return Ok(CollectorExit::Restart(next_run_id))
                }
                Ok(HelperCommand::Shutdown | HelperCommand::Disconnected) => {
                    return Ok(CollectorExit::Shutdown)
                }
                Ok(HelperCommand::Start(_) | HelperCommand::Stop(_))
                | Err(std::sync::mpsc::TryRecvError::Empty) => {}
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    return Ok(CollectorExit::Shutdown)
                }
            }
            match trace_result_rx.try_recv() {
                Ok(Ok(())) => {
                    let error = "Windows应用流量事件采集意外停止".to_string();
                    let _ = send_helper_message(
                        pipe,
                        HelperMessage {
                            token: token.to_string(),
                            run_id,
                            status: STATUS_ERROR.to_string(),
                            updated_at_ms: now_ms(),
                            applications: Vec::new(),
                            error: Some(error.clone()),
                        },
                    );
                    return Err(error);
                }
                Ok(Err(trace_error)) => {
                    let error = format!("Windows应用流量事件采集异常：{trace_error:?}");
                    let _ = send_helper_message(
                        pipe,
                        HelperMessage {
                            token: token.to_string(),
                            run_id,
                            status: STATUS_ERROR.to_string(),
                            updated_at_ms: now_ms(),
                            applications: Vec::new(),
                            error: Some(error.clone()),
                        },
                    );
                    return Err(error);
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    let error = "Windows应用流量事件处理线程已退出".to_string();
                    let _ = send_helper_message(
                        pipe,
                        HelperMessage {
                            token: token.to_string(),
                            run_id,
                            status: STATUS_ERROR.to_string(),
                            updated_at_ms: now_ms(),
                            applications: Vec::new(),
                            error: Some(error.clone()),
                        },
                    );
                    return Err(error);
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => {}
            }
            if last_snapshot.elapsed() < Duration::from_secs(5) {
                continue;
            }
            if let Some(error) = diagnostics.parsing_error() {
                let _ = send_helper_message(
                    pipe,
                    HelperMessage {
                        token: token.to_string(),
                        run_id,
                        status: STATUS_ERROR.to_string(),
                        updated_at_ms: now_ms(),
                        applications: Vec::new(),
                        error: Some(error.clone()),
                    },
                );
                return Err(error);
            }
            if trace_started.elapsed() >= Duration::from_secs(15)
                && diagnostics
                    .recorded_events
                    .load(std::sync::atomic::Ordering::Relaxed)
                    == 0
                && interface_baseline
                    .zip(crate::platform::network_traffic_totals().ok())
                    .is_some_and(|((start_received, start_sent), (received, sent))| {
                        received
                            .saturating_sub(start_received)
                            .saturating_add(sent.saturating_sub(start_sent))
                            >= 16 * 1024
                    })
            {
                let error = diagnostics.empty_collection_error();
                let _ = send_helper_message(
                    pipe,
                    HelperMessage {
                        token: token.to_string(),
                        run_id,
                        status: STATUS_ERROR.to_string(),
                        updated_at_ms: now_ms(),
                        applications: Vec::new(),
                        error: Some(error.clone()),
                    },
                );
                return Err(error);
            }
            let applications =
                match collector_snapshot_with_timeout(&collector, COLLECTOR_SNAPSHOT_TIMEOUT) {
                    Ok(applications) => applications,
                    Err(error) => {
                        let _ = send_helper_message(
                            pipe,
                            HelperMessage {
                                token: token.to_string(),
                                run_id,
                                status: STATUS_ERROR.to_string(),
                                updated_at_ms: now_ms(),
                                applications: Vec::new(),
                                error: Some(error.clone()),
                            },
                        );
                        return Err(error);
                    }
                };
            let collection_diagnostic = (trace_started.elapsed() >= Duration::from_secs(15)
                && applications.is_empty())
            .then(|| diagnostics.empty_collection_diagnostic());
            if send_helper_message(
                pipe,
                HelperMessage {
                    token: token.to_string(),
                    run_id,
                    status: STATUS_RUNNING.to_string(),
                    updated_at_ms: now_ms(),
                    applications,
                    error: collection_diagnostic,
                },
            )
            .is_err()
            {
                return Ok(CollectorExit::Shutdown);
            }
            last_snapshot = Instant::now();
        }
    })();

    // Stop by name first so an error closing the consumer handle cannot leave
    // an orphaned kernel session accumulating lost events. Fall back to the
    // owning handle when the name-based controller call itself fails.
    let cleanup_error = match ferrisetw::trace::stop_trace_by_name(&trace_name) {
        Ok(()) => {
            drop(traffic_trace);
            None
        }
        Err(name_error) => match traffic_trace.stop() {
            Ok(()) => None,
            Err(handle_error) => Some(format!(
                "停止Windows应用流量事件采集失败：按名称 {name_error:?}；按句柄 {handle_error:?}"
            )),
        },
    };
    let _ = trace_thread.join();

    match (monitor_result, cleanup_error) {
        (Err(error), Some(cleanup)) => Err(format!("{error}；{cleanup}")),
        (Err(error), None) => Err(error),
        (Ok(_), Some(cleanup)) => Err(cleanup),
        (Ok(exit), None) => Ok(exit),
    }
}

#[cfg(windows)]
fn connect_to_pipe(pipe_name: &str, kind: TrafficPipeKind) -> Result<std::fs::File, String> {
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::{
        Foundation::{
            GetLastError, ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY, GENERIC_READ, GENERIC_WRITE,
            INVALID_HANDLE_VALUE,
        },
        Storage::FileSystem::{CreateFileW, OPEN_EXISTING},
    };

    let name = wide(pipe_name);
    let desired_access = match kind {
        TrafficPipeKind::Data => GENERIC_READ,
        TrafficPipeKind::Control => GENERIC_WRITE,
    };
    for _ in 0..300 {
        let handle = unsafe {
            CreateFileW(
                name.as_ptr(),
                desired_access,
                0,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        if handle != INVALID_HANDLE_VALUE {
            return Ok(unsafe { std::fs::File::from_raw_handle(handle as _) });
        }
        let error = unsafe { GetLastError() };
        if !matches!(error, ERROR_PIPE_BUSY | ERROR_FILE_NOT_FOUND) {
            return Err(format!(
                "连接应用流量通信管道失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Err("连接应用流量通信管道超时".to_string())
}

#[cfg(windows)]
fn send_helper_message(pipe: &mut std::fs::File, message: HelperMessage) -> Result<(), String> {
    use std::io::Write;
    let mut payload =
        serde_json::to_vec(&message).map_err(|error| format!("序列化应用流量快照失败：{error}"))?;
    payload.push(b'\n');
    pipe.write_all(&payload)
        .and_then(|_| pipe.flush())
        .map_err(|error| format!("发送应用流量快照失败：{error}"))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn identity(id: &str, name: &str) -> ProcessIdentity {
        ProcessIdentity {
            id: id.to_string(),
            name: name.to_string(),
            path: Some(format!(r"C:\Apps\{name}.exe")),
            started_at_100ns: None,
        }
    }

    #[test]
    fn uses_product_name_for_haruha_executable() {
        assert_eq!(application_display_name("proxy-manager-next.exe"), "Haruha");
        assert_eq!(application_display_name("Haruha.exe"), "Haruha");
    }

    #[test]
    fn prefers_windows_metadata_for_unmapped_executables() {
        assert_eq!(
            application_display_name_with_metadata(
                "GameViewerServer.exe",
                Some("网易UU远程服务".to_string()),
            ),
            "网易UU远程服务"
        );
        assert_eq!(
            application_display_name_with_metadata(
                "chrome.exe",
                Some("unexpected metadata".to_string()),
            ),
            "Google Chrome"
        );
        assert_eq!(
            application_display_name_with_metadata("NoMetadata.exe", None),
            "NoMetadata"
        );
    }

    #[test]
    fn absolute_etw_image_paths_use_the_same_application_id_as_process_queries() {
        let identity = identity_from_image_name(r"C:\Apps\Example\Viewer.exe")
            .expect("absolute image identity");
        assert_eq!(identity.id, application_id(r"c:\apps\example\viewer.exe"));

        let basename = identity_from_image_name("Viewer.exe").expect("basename identity");
        assert_ne!(basename.id, identity.id);
    }

    #[test]
    fn short_etw_image_names_are_replaced_with_resolved_paths_before_recording() {
        let mut state = CollectorState::default();
        let short_identity = identity_from_image_name("python.exe").expect("short identity");
        state.process_started(4242, short_identity.clone());

        assert!(matches!(
            state.record_cached(4242, 1_024, TrafficDirection::Download),
            CachedRecordResult::MissingProcess
        ));

        let resolved_identity =
            identity_from_image_name(r"C:\Python\python.exe").expect("resolved identity");
        state.record_resolved_at(
            4242,
            resolved_identity.clone(),
            1_024,
            TrafficDirection::Download,
            None,
        );

        let snapshot = state.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].id, resolved_identity.id);
        assert_eq!(snapshot[0].path.as_deref(), Some(r"C:\Python\python.exe"));
        assert_ne!(snapshot[0].id, short_identity.id);
    }

    #[test]
    fn extracts_a_png_data_url_for_a_windows_executable() {
        let executable = std::env::current_exe().expect("current executable path");
        let icon = application_icon_data_url(&executable.to_string_lossy())
            .expect("extract executable icon");
        assert!(icon.starts_with("data:image/png;base64,"));
        assert!(icon.len() > "data:image/png;base64,".len());
    }

    #[test]
    fn reads_a_windows_file_version_resource() {
        let system_root = std::env::var_os("SystemRoot").expect("SystemRoot");
        let kernel32 = std::path::PathBuf::from(system_root)
            .join("System32")
            .join("kernel32.dll");
        assert!(is_local_version_info_path(&kernel32.to_string_lossy()));
        assert!(!is_local_version_info_path(r"\\server\share\RemoteApp.exe"));
        let display_name = file_version_display_name(&kernel32.to_string_lossy())
            .expect("kernel32 version display name");
        assert!(!display_name.trim().is_empty());
    }

    #[test]
    fn startup_wait_returns_only_after_running_confirmation() {
        let manager = TrafficMonitorManager::new();
        let generation = {
            let mut state = manager.inner.lock().expect("monitor state");
            state.generation = 41;
            state.run_id = 7;
            state.snapshot.status = STATUS_STARTING.to_string();
            (state.generation, state.run_id)
        };
        let updater = manager.clone();
        let update_thread = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(20));
            let mut state = updater.inner.lock().expect("monitor state");
            state.snapshot.status = STATUS_RUNNING.to_string();
            state.snapshot.updated_at_ms = now_ms();
        });

        let snapshot = manager
            .wait_for_startup(
                generation.0,
                generation.1,
                std::time::Duration::from_secs(1),
            )
            .expect("running confirmation");
        update_thread.join().expect("status update thread");
        assert_eq!(snapshot.status, STATUS_RUNNING);
    }

    #[test]
    fn startup_wait_surfaces_the_collector_error() {
        let manager = TrafficMonitorManager::new();
        let generation = {
            let mut state = manager.inner.lock().expect("monitor state");
            state.generation = 42;
            state.run_id = 8;
            state.snapshot.status = STATUS_ERROR.to_string();
            state.snapshot.error = Some("ETW failed".to_string());
            (state.generation, state.run_id)
        };

        let error = manager
            .wait_for_startup(
                generation.0,
                generation.1,
                std::time::Duration::from_secs(1),
            )
            .expect_err("collector error");
        assert_eq!(error, "ETW failed");
    }

    #[test]
    fn parses_only_authenticated_session_commands() {
        assert_eq!(
            parse_helper_command("start session-token 12", "session-token"),
            Some(HelperCommand::Start(12))
        );
        assert_eq!(
            parse_helper_command("stop session-token 12", "session-token"),
            Some(HelperCommand::Stop(12))
        );
        assert_eq!(
            parse_helper_command("shutdown session-token", "session-token"),
            Some(HelperCommand::Shutdown)
        );
        assert_eq!(
            parse_helper_command("start wrong-token 12", "session-token"),
            None
        );
        assert_eq!(
            parse_helper_command("start session-token", "session-token"),
            None
        );
    }

    #[test]
    fn stop_keeps_the_helper_session_for_the_next_start() {
        let manager = TrafficMonitorManager::new();
        let control_path = std::env::temp_dir().join(format!(
            "haruha-traffic-control-{}-{}.txt",
            std::process::id(),
            now_ms()
        ));
        let control = std::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .read(true)
            .write(true)
            .open(&control_path)
            .expect("control file");
        {
            let mut state = manager.inner.lock().expect("monitor state");
            state.generation = 3;
            state.run_id = 9;
            state.token = "session-token".to_string();
            state.control = Some(control);
            state.snapshot.status = STATUS_RUNNING.to_string();
        }

        let snapshot = manager.stop();
        assert_eq!(snapshot.status, STATUS_IDLE);
        let state = manager.inner.lock().expect("monitor state");
        assert_eq!(state.generation, 3);
        assert_eq!(state.run_id, 10);
        assert_eq!(state.token, "session-token");
        assert!(state.control.is_some());
        drop(state);
        assert_eq!(
            std::fs::read_to_string(&control_path).expect("control command"),
            "stop session-token 9\n"
        );
        manager.shutdown();
        let _ = std::fs::remove_file(control_path);
    }

    #[test]
    fn stale_helper_messages_cannot_overwrite_a_new_monitor_run() {
        let manager = TrafficMonitorManager::new();
        {
            let mut state = manager.inner.lock().expect("monitor state");
            state.generation = 5;
            state.run_id = 22;
            state.token = "session-token".to_string();
            state.snapshot = starting_snapshot();
        }
        apply_helper_message(
            &manager.inner,
            5,
            HelperMessage {
                token: "session-token".to_string(),
                run_id: 21,
                status: STATUS_RUNNING.to_string(),
                updated_at_ms: now_ms(),
                applications: Vec::new(),
                error: None,
            },
        );
        assert_eq!(manager.snapshot().status, STATUS_STARTING);

        apply_helper_message(
            &manager.inner,
            5,
            HelperMessage {
                token: "session-token".to_string(),
                run_id: 22,
                status: STATUS_RUNNING.to_string(),
                updated_at_ms: now_ms(),
                applications: Vec::new(),
                error: None,
            },
        );
        assert_eq!(manager.snapshot().status, STATUS_RUNNING);
    }

    #[test]
    fn repeated_network_parse_failures_become_an_explicit_error() {
        let diagnostics = CollectorDiagnostics::default();
        for _ in 0..10 {
            CollectorDiagnostics::increment(&diagnostics.data_events);
            CollectorDiagnostics::increment(&diagnostics.address_failures);
        }
        let error = diagnostics.parsing_error().expect("parse error");
        assert!(error.contains("地址失败 10"));

        CollectorDiagnostics::increment(&diagnostics.recorded_events);
        assert_eq!(diagnostics.parsing_error(), None);
    }

    #[test]
    fn empty_collection_error_reports_the_full_event_pipeline() {
        let diagnostics = CollectorDiagnostics::default();
        CollectorDiagnostics::increment(&diagnostics.callback_events);
        CollectorDiagnostics::increment(&diagnostics.unsupported_opcodes);
        CollectorDiagnostics::increment(&diagnostics.loopback_events);

        let error = diagnostics.empty_collection_error();
        assert!(error.contains("网络回调 1"));
        assert!(error.contains("未识别操作 1"));
        assert!(error.contains("回环 1"));
        assert!(error.contains("已记录 0"));

        let diagnostic = diagnostics.empty_collection_diagnostic();
        assert!(diagnostic.starts_with("尚未形成应用统计"));
        assert!(!diagnostic.contains("系统网卡已有流量"));
    }

    #[test]
    fn maps_tcp_udp_and_ip_versions_to_the_correct_direction() {
        for event_id in [10, 26, 42, 58] {
            assert_eq!(
                direction_for_network_opcode(event_id),
                Some(TrafficDirection::Upload)
            );
        }
        for event_id in [11, 27, 43, 59] {
            assert_eq!(
                direction_for_network_opcode(event_id),
                Some(TrafficDirection::Download)
            );
        }
        assert_eq!(direction_for_network_opcode(12), None);
    }

    #[test]
    fn named_pipe_handshake_connects_within_the_deadline() {
        let (pipe_name, _, _) = session_credentials().expect("session credentials");
        let pipe_handle =
            create_pipe_server(&pipe_name, TrafficPipeKind::Data).expect("pipe server");
        let client = std::thread::spawn(move || connect_to_pipe(&pipe_name, TrafficPipeKind::Data));
        let connected = wait_for_pipe_client(pipe_handle, std::time::Duration::from_secs(2));
        let client_result = client.join().expect("pipe client thread");
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(pipe_handle as _);
        }
        assert!(
            connected.is_ok() && client_result.is_ok(),
            "server={connected:?}, client={client_result:?}"
        );
    }

    #[test]
    fn data_and_control_pipes_connect_in_helper_order() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::windows::io::FromRawHandle;

        let (data_pipe_name, control_pipe_name, _) =
            session_credentials().expect("session credentials");
        let data_pipe_handle =
            create_pipe_server(&data_pipe_name, TrafficPipeKind::Data).expect("data pipe server");
        let control_pipe_handle = create_pipe_server(&control_pipe_name, TrafficPipeKind::Control)
            .expect("control pipe server");
        let client = std::thread::spawn(move || {
            let data = connect_to_pipe(&data_pipe_name, TrafficPipeKind::Data)?;
            let control = connect_to_pipe(&control_pipe_name, TrafficPipeKind::Control)?;
            Ok::<_, String>((data, control))
        });

        let data_connected =
            wait_for_pipe_client(data_pipe_handle, std::time::Duration::from_secs(2));
        let control_connected =
            wait_for_pipe_client(control_pipe_handle, std::time::Duration::from_secs(2));
        let client_result = client.join().expect("pipe client thread");
        assert!(
            data_connected.is_ok() && control_connected.is_ok() && client_result.is_ok(),
            "data={data_connected:?}, control={control_connected:?}, client={client_result:?}"
        );
        let (data_client, mut control_client) = client_result.expect("pipe clients");
        let mut data_server = unsafe { std::fs::File::from_raw_handle(data_pipe_handle as _) };
        let control_server = unsafe { std::fs::File::from_raw_handle(control_pipe_handle as _) };

        data_server
            .write_all(b"first\nsecond\n")
            .expect("data write");
        data_server.flush().expect("data flush");
        let mut data_reader = BufReader::new(data_client);
        let mut first = String::new();
        let mut second = String::new();
        data_reader.read_line(&mut first).expect("first data line");
        data_reader
            .read_line(&mut second)
            .expect("second data line");

        control_client
            .write_all(b"stop token\n")
            .expect("stop write");
        control_client.flush().expect("stop flush");
        let mut control_reader = BufReader::new(control_server);
        let mut stop = String::new();
        control_reader.read_line(&mut stop).expect("stop read");

        assert_eq!(first, "first\n");
        assert_eq!(second, "second\n");
        assert_eq!(stop, "stop token\n");
    }

    #[test]
    fn session_uses_distinct_data_and_control_pipes() {
        let (data_pipe_name, control_pipe_name, token) =
            session_credentials().expect("session credentials");
        assert_ne!(data_pipe_name, control_pipe_name);
        assert!(data_pipe_name.ends_with(".data"));
        assert!(control_pipe_name.ends_with(".control"));
        assert!(!token.is_empty());
    }

    #[test]
    fn stale_running_snapshot_becomes_an_explicit_error() {
        let manager = TrafficMonitorManager::new();
        let generation = {
            let mut state = manager.inner.lock().expect("monitor state");
            state.generation = 9;
            state.token = "stale-token".to_string();
            state.snapshot.status = STATUS_RUNNING.to_string();
            state.last_message_received_at = std::time::Instant::now()
                .checked_sub(SNAPSHOT_HEARTBEAT_TIMEOUT)
                .or_else(|| Some(std::time::Instant::now()));
            state.generation
        };

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.status, STATUS_ERROR);
        assert!(snapshot
            .error
            .as_deref()
            .is_some_and(|error| error.contains("超过15秒未发送新快照")));
        let state = manager.inner.lock().expect("monitor state");
        assert_ne!(state.generation, generation);
        assert!(state.token.is_empty());
        assert!(state.last_message_received_at.is_none());
    }

    #[test]
    fn collector_snapshot_wait_is_bounded() {
        let collector = Arc::new(Mutex::new(CollectorState::default()));
        let guard = collector.lock().expect("collector lock");
        let error =
            collector_snapshot_with_timeout(&collector, std::time::Duration::from_millis(10))
                .expect_err("busy collector");
        assert!(error.contains("10毫秒内无法生成快照"));
        drop(guard);
        assert!(
            collector_snapshot_with_timeout(&collector, std::time::Duration::from_millis(10))
                .is_ok()
        );
    }

    #[test]
    fn excludes_ipv4_and_ipv6_loopback_events() {
        assert!(is_loopback_event(
            "127.0.0.1".parse().unwrap(),
            "127.0.0.1".parse().unwrap()
        ));
        assert!(is_loopback_event(
            "::1".parse().unwrap(),
            "::1".parse().unwrap()
        ));
        assert!(!is_loopback_event(
            "192.168.1.8".parse().unwrap(),
            "1.1.1.1".parse().unwrap()
        ));
    }

    #[test]
    fn merges_multiple_processes_and_keeps_direction_totals() {
        let mut state = CollectorState::default();
        state.record_resolved(
            100,
            identity("chrome", "Chrome"),
            1_000,
            TrafficDirection::Download,
        );
        state.record_resolved(
            101,
            identity("chrome", "Chrome"),
            250,
            TrafficDirection::Upload,
        );
        let snapshot = state.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].download_bytes, 1_000);
        assert_eq!(snapshot[0].upload_bytes, 250);
        assert_eq!(snapshot[0].process_count, 2);
    }

    #[test]
    fn background_name_enrichment_preserves_usage_and_future_updates() {
        let mut state = CollectorState::default();
        state.record_resolved(
            6808,
            identity("game-viewer", "GameViewerServer"),
            4_096,
            TrafficDirection::Download,
        );
        state.update_identity_name("game-viewer", "网易UU远程服务");
        assert!(matches!(
            state.record_cached(6808, 512, TrafficDirection::Upload),
            CachedRecordResult::Recorded {
                identity_to_enrich: None
            }
        ));

        let snapshot = state.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].name, "网易UU远程服务");
        assert_eq!(snapshot[0].download_bytes, 4_096);
        assert_eq!(snapshot[0].upload_bytes, 512);
        assert_eq!(state.processes[&6808].name, "网易UU远程服务");
    }

    #[test]
    fn network_events_older_than_a_reused_pid_are_kept_unattributed() {
        let mut state = CollectorState::default();
        let mut current_process = identity("current", "Current");
        current_process.started_at_100ns = Some(2_000);

        state.record_resolved_at(
            8080,
            current_process,
            400,
            TrafficDirection::Download,
            Some(1_000),
        );
        assert!(matches!(
            state.record_cached_at(8080, 600, TrafficDirection::Upload, Some(3_000)),
            CachedRecordResult::Recorded { .. }
        ));

        let snapshot = state.snapshot();
        assert_eq!(
            snapshot
                .iter()
                .find(|application| application.id == "system-unknown")
                .expect("unattributed old event")
                .download_bytes,
            400
        );
        let current = snapshot
            .iter()
            .find(|application| application.id == "current")
            .expect("current process event");
        assert_eq!(current.upload_bytes, 600);
        assert_eq!(current.download_bytes, 0);
    }

    #[test]
    fn full_name_enrichment_queue_retries_without_changing_usage() {
        let collector = Arc::new(Mutex::new(CollectorState::default()));
        let first_identity = {
            let mut state = collector.lock().expect("collector state");
            state
                .record_resolved(
                    6808,
                    identity("game-viewer", "GameViewerServer"),
                    1_024,
                    TrafficDirection::Download,
                )
                .expect("initial enrichment")
        };
        let (sender, _receiver) = std::sync::mpsc::sync_channel(0);
        queue_application_name_enrichment(&sender, &collector, first_identity);

        let mut state = collector.lock().expect("collector state");
        let retry = state.record_cached(6808, 256, TrafficDirection::Upload);
        assert!(matches!(
            retry,
            CachedRecordResult::Recorded {
                identity_to_enrich: Some(_)
            }
        ));
        let snapshot = state.snapshot();
        assert_eq!(snapshot[0].download_bytes, 1_024);
        assert_eq!(snapshot[0].upload_bytes, 256);
    }

    #[test]
    fn process_exit_and_pid_reuse_do_not_merge_different_apps() {
        let mut state = CollectorState::default();
        state.record_resolved(200, identity("old", "Old"), 400, TrafficDirection::Download);
        state.process_exited(200);
        state.record_resolved(200, identity("new", "New"), 700, TrafficDirection::Upload);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.len(), 2);
        assert_eq!(
            snapshot
                .iter()
                .find(|item| item.id == "old")
                .unwrap()
                .process_count,
            0
        );
        assert_eq!(
            snapshot
                .iter()
                .find(|item| item.id == "new")
                .unwrap()
                .process_count,
            1
        );
    }

    #[test]
    fn keeps_unknown_processes_as_an_explicit_application() {
        let mut state = CollectorState::default();
        state.record_resolved(4, unknown_identity(), 2_048, TrafficDirection::Download);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].id, "system-unknown");
        assert_eq!(snapshot[0].name, "系统/未知");
        assert_eq!(snapshot[0].download_bytes, 2_048);
    }

    #[test]
    fn reorders_each_snapshot_by_the_latest_session_total() {
        let mut state = CollectorState::default();
        state.record_resolved(
            10,
            identity("alpha", "Alpha"),
            400,
            TrafficDirection::Download,
        );
        state.record_resolved(
            20,
            identity("beta", "Beta"),
            800,
            TrafficDirection::Download,
        );
        assert_eq!(state.snapshot()[0].id, "beta");

        state.record_resolved(
            10,
            identity("alpha", "Alpha"),
            700,
            TrafficDirection::Upload,
        );
        assert_eq!(state.snapshot()[0].id, "alpha");
    }

    #[test]
    fn a_new_collector_resets_the_session_totals() {
        let mut first = CollectorState::default();
        first.record_resolved(1, identity("app", "App"), 512, TrafficDirection::Download);
        assert_eq!(first.snapshot().len(), 1);
        assert!(CollectorState::default().snapshot().is_empty());
    }
}

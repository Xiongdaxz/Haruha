use anyhow::Context;
use anyhow::Result;

#[cfg(windows)]
pub struct SingleInstanceGuard {
    handle: isize,
}

#[cfg(windows)]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;

        unsafe {
            CloseHandle(self.handle as _);
        }
    }
}

#[cfg(windows)]
pub fn acquire() -> Result<Option<SingleInstanceGuard>> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_ALREADY_EXISTS},
        System::Threading::CreateMutexW,
    };

    #[cfg(debug_assertions)]
    let mutex_name = "Local\\Haruha.ProxyManager.SingleInstance.Debug";
    #[cfg(not(debug_assertions))]
    let mutex_name = "Local\\Haruha.ProxyManager.SingleInstance";
    let name = wide(mutex_name);
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() {
        return Err(std::io::Error::last_os_error()).context("创建单实例互斥体失败");
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(handle);
        }
        focus_existing_window();
        return Ok(None);
    }

    Ok(Some(SingleInstanceGuard {
        handle: handle as isize,
    }))
}

#[cfg(windows)]
fn focus_existing_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    let title = wide(crate::MAIN_WINDOW_TITLE);
    let window = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
    if !window.is_null() {
        unsafe {
            ShowWindow(window, SW_RESTORE);
            SetForegroundWindow(window);
        }
    }
}

#[cfg(windows)]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(not(windows))]
pub struct SingleInstanceGuard {
    _file: std::fs::File,
}

#[cfg(not(windows))]
pub fn acquire() -> Result<Option<SingleInstanceGuard>> {
    use std::{fs::OpenOptions, os::fd::AsRawFd};

    let directory = dirs::config_dir().context("无法获取系统配置目录")?;
    std::fs::create_dir_all(&directory)?;
    #[cfg(debug_assertions)]
    let lock_file_name = ".haruha-proxy-manager.debug.lock";
    #[cfg(not(debug_assertions))]
    let lock_file_name = ".haruha-proxy-manager.lock";
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(directory.join(lock_file_name))?;
    const LOCK_EX: i32 = 2;
    const LOCK_NB: i32 = 4;
    if unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::WouldBlock {
            return Ok(None);
        }
        return Err(error).context("获取单实例文件锁失败");
    }
    Ok(Some(SingleInstanceGuard { _file: file }))
}

#[cfg(not(windows))]
extern "C" {
    fn flock(file_descriptor: i32, operation: i32) -> i32;
}

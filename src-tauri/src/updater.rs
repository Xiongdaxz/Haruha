use std::{
    fs::{self, File},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{bail, Context, Result};
use reqwest::{header::ACCEPT, Client, Proxy, Response, Url};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const DEFAULT_RELEASE_API_URL: &str =
    "https://api.github.com/repos/Xiongdaxz/Haruha/releases/latest";
const DEFAULT_UPDATE_MANIFEST_URL: &str =
    "https://github.com/Xiongdaxz/Haruha/releases/latest/download/update.json";
const UPDATE_API_URL_ENV: &str = "HARUHA_UPDATE_API_URL";
const UPDATE_MANIFEST_URL_ENV: &str = "HARUHA_UPDATE_MANIFEST_URL";
const UPDATE_MANIFEST_SCHEMA_VERSION: u32 = 1;
const UPDATE_DOWNLOAD_PROGRESS_EVENT: &str = "update-download-progress";
const MAX_UPDATE_BYTES: u64 = 300 * 1024 * 1024;
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const UPDATE_HELPER_FLAG: &str = "--haruha-apply-portable-update";
const UPDATE_RESULT_FILE_NAME: &str = "last-update-result.json";

#[derive(Debug, Clone, Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateManifest {
    schema_version: u32,
    version: String,
    tag_name: String,
    published_at: Option<String>,
    #[serde(default)]
    notes: Vec<String>,
    assets: Vec<UpdateManifestAsset>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateManifestAsset {
    name: String,
    architecture: String,
    install_kind: String,
    size_bytes: u64,
    sha256: String,
    download_url: String,
}

#[derive(Debug, Clone)]
struct UpdateCandidate {
    version: Version,
    tag_name: String,
    published_at: Option<String>,
    notes: Vec<String>,
    asset_name: String,
    size_bytes: u64,
    sha256: String,
    download_url: String,
}

#[derive(Debug, Clone)]
struct CachedUpdate {
    info: UpdateInfo,
    download_url: String,
    sha256: String,
}

#[derive(Debug, Clone)]
struct PreparedUpdateInternal {
    version: String,
    path: PathBuf,
    sha256: String,
    size_bytes: u64,
    file_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub tag_name: String,
    pub published_at: Option<String>,
    pub notes: Vec<String>,
    pub size_bytes: u64,
    pub asset_name: String,
    pub architecture: String,
    pub install_kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub checked_at_ms: u64,
    pub update: Option<UpdateInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDownloadProgress {
    pub version: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub bytes_per_second: f64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedUpdate {
    pub version: String,
    pub size_bytes: u64,
    pub file_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateApplyResult {
    pub success: bool,
    pub version: String,
    pub message: String,
    pub completed_at_ms: u64,
}

pub struct UpdateManager {
    operation: tokio::sync::Mutex<()>,
    offer: Mutex<Option<CachedUpdate>>,
    prepared: Mutex<Option<PreparedUpdateInternal>>,
    cancel_download: AtomicBool,
}

impl UpdateManager {
    pub fn new() -> Self {
        Self {
            operation: tokio::sync::Mutex::new(()),
            offer: Mutex::new(None),
            prepared: Mutex::new(None),
            cancel_download: AtomicBool::new(false),
        }
    }

    pub async fn check(&self, proxy_address: Option<&str>) -> Result<UpdateCheckResult> {
        let _operation = self.operation.lock().await;
        let current_version =
            Version::parse(env!("CARGO_PKG_VERSION")).context("当前程序版本格式无效")?;
        let architecture = windows_architecture()?;
        let candidate = fetch_latest_update(proxy_address, architecture).await?;
        let latest_version = candidate.version.clone();
        let checked_at_ms = now_ms();

        if latest_version <= current_version {
            clear_mutex(&self.offer, "更新信息锁已损坏")?;
            clear_mutex(&self.prepared, "更新文件锁已损坏")?;
            return Ok(UpdateCheckResult {
                current_version: current_version.to_string(),
                latest_version: latest_version.to_string(),
                checked_at_ms,
                update: None,
            });
        }

        let info = UpdateInfo {
            version: latest_version.to_string(),
            tag_name: candidate.tag_name,
            published_at: candidate.published_at,
            notes: candidate.notes,
            size_bytes: candidate.size_bytes,
            asset_name: candidate.asset_name,
            architecture: architecture.to_string(),
            install_kind: "portable",
        };
        let offer = CachedUpdate {
            info: info.clone(),
            download_url: candidate.download_url,
            sha256: candidate.sha256,
        };
        *self
            .offer
            .lock()
            .map_err(|_| anyhow::anyhow!("更新信息锁已损坏"))? = Some(offer);
        clear_mutex(&self.prepared, "更新文件锁已损坏")?;

        Ok(UpdateCheckResult {
            current_version: current_version.to_string(),
            latest_version: latest_version.to_string(),
            checked_at_ms,
            update: Some(info),
        })
    }

    pub async fn download(
        &self,
        app: &AppHandle,
        proxy_address: Option<&str>,
    ) -> Result<PreparedUpdate> {
        let _operation = self.operation.lock().await;
        self.cancel_download.store(false, Ordering::SeqCst);
        let offer = self
            .offer
            .lock()
            .map_err(|_| anyhow::anyhow!("更新信息锁已损坏"))?
            .clone()
            .context("请先检查更新")?;

        let update_dir = update_dir()?;
        fs::create_dir_all(&update_dir)
            .with_context(|| format!("创建更新目录失败：{}", update_dir.display()))?;
        let final_path = update_dir.join(&offer.info.asset_name);
        if final_path.exists()
            && verify_executable(&final_path, &offer.sha256, offer.info.size_bytes).is_ok()
        {
            return self.remember_prepared(&offer, final_path);
        }
        if final_path.exists() {
            fs::remove_file(&final_path)
                .with_context(|| format!("清理无效更新包失败：{}", final_path.display()))?;
        }

        let part_path = final_path.with_extension("exe.part");
        if part_path.exists() {
            fs::remove_file(&part_path)
                .with_context(|| format!("清理未完成下载失败：{}", part_path.display()))?;
        }

        let result = self
            .download_to_path(app, proxy_address, &offer, &part_path)
            .await;
        if let Err(error) = result {
            let _ = fs::remove_file(&part_path);
            return Err(error);
        }
        tokio::fs::rename(&part_path, &final_path)
            .await
            .with_context(|| format!("保存更新包失败：{}", final_path.display()))?;
        verify_executable(&final_path, &offer.sha256, offer.info.size_bytes)?;
        self.remember_prepared(&offer, final_path)
    }

    async fn download_to_path(
        &self,
        app: &AppHandle,
        proxy_address: Option<&str>,
        offer: &CachedUpdate,
        part_path: &Path,
    ) -> Result<()> {
        let mut response = send_request(
            &offer.download_url,
            proxy_address,
            None,
            "application/octet-stream",
        )
        .await?
        .error_for_status()
        .context("更新包下载请求失败")?;
        if let Some(content_length) = response.content_length() {
            if content_length != offer.info.size_bytes {
                bail!(
                    "更新包大小与发布信息不一致：预期 {}，实际 {}",
                    offer.info.size_bytes,
                    content_length
                );
            }
        }

        let mut file = tokio::fs::File::create(part_path)
            .await
            .with_context(|| format!("创建更新临时文件失败：{}", part_path.display()))?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0_u64;
        let started = Instant::now();
        let mut last_emitted = Instant::now() - Duration::from_secs(1);

        while let Some(chunk) = response.chunk().await.context("读取更新包失败")? {
            if self.cancel_download.load(Ordering::SeqCst) {
                bail!("更新下载已取消");
            }
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if downloaded > offer.info.size_bytes || downloaded > MAX_UPDATE_BYTES {
                bail!("更新包超过预期大小，已停止下载");
            }
            file.write_all(&chunk).await.context("写入更新包失败")?;
            hasher.update(&chunk);

            if last_emitted.elapsed() >= Duration::from_millis(100) {
                emit_download_progress(app, &offer.info, downloaded, started.elapsed());
                last_emitted = Instant::now();
            }
        }
        file.flush().await.context("刷新更新包失败")?;
        file.sync_all().await.context("同步更新包失败")?;

        if downloaded != offer.info.size_bytes {
            bail!(
                "更新包下载不完整：预期 {}，实际 {}",
                offer.info.size_bytes,
                downloaded
            );
        }
        let actual_sha256 = format!("{:x}", hasher.finalize());
        if actual_sha256 != offer.sha256 {
            bail!("更新包 SHA-256 校验失败");
        }
        emit_download_progress(app, &offer.info, downloaded, started.elapsed());
        Ok(())
    }

    fn remember_prepared(&self, offer: &CachedUpdate, path: PathBuf) -> Result<PreparedUpdate> {
        let prepared = PreparedUpdateInternal {
            version: offer.info.version.clone(),
            path,
            sha256: offer.sha256.clone(),
            size_bytes: offer.info.size_bytes,
            file_name: offer.info.asset_name.clone(),
        };
        *self
            .prepared
            .lock()
            .map_err(|_| anyhow::anyhow!("更新文件锁已损坏"))? = Some(prepared.clone());
        Ok(PreparedUpdate {
            version: prepared.version,
            size_bytes: prepared.size_bytes,
            file_name: prepared.file_name,
        })
    }

    pub fn cancel_download(&self) {
        self.cancel_download.store(true, Ordering::SeqCst);
    }

    #[cfg(windows)]
    pub fn launch_portable_installer(&self) -> Result<String> {
        if cfg!(debug_assertions) {
            bail!("开发模式下不执行程序替换，请使用正式便携版验证更新");
        }
        let prepared = self
            .prepared
            .lock()
            .map_err(|_| anyhow::anyhow!("更新文件锁已损坏"))?
            .clone()
            .context("更新包尚未下载完成")?;
        verify_executable(&prepared.path, &prepared.sha256, prepared.size_bytes)?;

        let current_exe = std::env::current_exe().context("无法定位当前程序")?;
        let update_dir = update_dir()?;
        fs::create_dir_all(&update_dir)?;
        let process_id = std::process::id();
        let helper_path = update_dir.join(format!("Haruha-update-helper-{process_id}.exe"));
        fs::copy(&current_exe, &helper_path)
            .with_context(|| format!("创建更新助手失败：{}", helper_path.display()))?;
        let backup_path = current_exe.with_file_name(format!(
            ".Haruha-update-backup-{}-{process_id}.exe",
            env!("CARGO_PKG_VERSION")
        ));
        let result_path = update_dir.join(UPDATE_RESULT_FILE_NAME);

        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new(&helper_path)
            .arg(UPDATE_HELPER_FLAG)
            .arg(process_id.to_string())
            .arg(&prepared.path)
            .arg(&current_exe)
            .arg(&backup_path)
            .arg(&prepared.sha256)
            .arg(&prepared.version)
            .arg(&result_path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .context("启动更新助手失败")?;

        Ok(prepared.version)
    }

    #[cfg(not(windows))]
    pub fn launch_portable_installer(&self) -> Result<String> {
        bail!("当前平台暂不支持便携版应用内更新")
    }
}

fn clear_mutex<T>(mutex: &Mutex<Option<T>>, message: &'static str) -> Result<()> {
    *mutex.lock().map_err(|_| anyhow::anyhow!(message))? = None;
    Ok(())
}

async fn fetch_latest_update(
    proxy_address: Option<&str>,
    architecture: &str,
) -> Result<UpdateCandidate> {
    let manifest_url = std::env::var(UPDATE_MANIFEST_URL_ENV)
        .unwrap_or_else(|_| DEFAULT_UPDATE_MANIFEST_URL.to_string());
    let api_url =
        std::env::var(UPDATE_API_URL_ENV).unwrap_or_else(|_| DEFAULT_RELEASE_API_URL.to_string());
    fetch_latest_update_from_urls(&manifest_url, &api_url, proxy_address, architecture).await
}

async fn fetch_latest_update_from_urls(
    manifest_url: &str,
    api_url: &str,
    proxy_address: Option<&str>,
    architecture: &str,
) -> Result<UpdateCandidate> {
    match fetch_update_manifest(manifest_url, proxy_address, architecture).await {
        Ok(candidate) => Ok(candidate),
        Err(manifest_error) => {
            match fetch_github_release(api_url, proxy_address, architecture).await {
                Ok(candidate) => Ok(candidate),
                Err(api_error) => bail!(
                "静态更新清单不可用：{manifest_error:#}；GitHub Release API 也不可用：{api_error:#}"
            ),
            }
        }
    }
}

async fn fetch_update_manifest(
    url: &str,
    proxy_address: Option<&str>,
    architecture: &str,
) -> Result<UpdateCandidate> {
    send_request(url, proxy_address, Some(CHECK_TIMEOUT), "application/json")
        .await?
        .json::<UpdateManifest>()
        .await
        .context("解析静态更新清单失败")
        .and_then(|manifest| validate_update_manifest(manifest, architecture))
}

async fn fetch_github_release(
    url: &str,
    proxy_address: Option<&str>,
    architecture: &str,
) -> Result<UpdateCandidate> {
    let release = send_request(
        url,
        proxy_address,
        Some(CHECK_TIMEOUT),
        "application/vnd.github+json",
    )
    .await?
    .json::<GithubRelease>()
    .await
    .context("解析 GitHub Release 更新信息失败")?;
    validate_github_release(release, architecture)
}

fn validate_update_manifest(
    manifest: UpdateManifest,
    architecture: &str,
) -> Result<UpdateCandidate> {
    if manifest.schema_version != UPDATE_MANIFEST_SCHEMA_VERSION {
        bail!("静态更新清单版本不受支持：{}", manifest.schema_version);
    }
    let version = Version::parse(manifest.version.trim())
        .with_context(|| format!("静态更新清单版本号格式无效：{}", manifest.version))?;
    if !version.pre.is_empty() {
        bail!("静态更新清单不能发布预发布版本：{version}");
    }
    let tag_version = parse_release_version(&manifest.tag_name)?;
    if tag_version != version {
        bail!(
            "静态更新清单版本与标签不一致：{} / {}",
            manifest.version,
            manifest.tag_name
        );
    }

    let expected_asset_name = expected_portable_asset_name(&manifest.tag_name, architecture);
    let asset = manifest
        .assets
        .into_iter()
        .find(|asset| asset.name == expected_asset_name)
        .with_context(|| format!("静态更新清单缺少便携版资产：{expected_asset_name}"))?;
    if asset.architecture != architecture {
        bail!(
            "静态更新清单资产架构不匹配：预期 {architecture}，实际 {}",
            asset.architecture
        );
    }
    if asset.install_kind != "portable" {
        bail!("静态更新清单资产不是便携版：{}", asset.install_kind);
    }
    validate_update_size(asset.size_bytes)?;
    let sha256 = parse_manifest_sha256(&asset.sha256)?;
    let download_url = validate_download_url(&asset.download_url)?;

    Ok(UpdateCandidate {
        version,
        tag_name: manifest.tag_name,
        published_at: manifest.published_at,
        notes: normalize_notes(manifest.notes),
        asset_name: asset.name,
        size_bytes: asset.size_bytes,
        sha256,
        download_url,
    })
}

fn validate_github_release(release: GithubRelease, architecture: &str) -> Result<UpdateCandidate> {
    if release.draft || release.prerelease {
        bail!("最新发布版本不是稳定公开版本");
    }
    let version = parse_release_version(&release.tag_name)?;
    if !version.pre.is_empty() {
        bail!("最新发布版本是预发布版本：{version}");
    }
    let expected_asset_name = expected_portable_asset_name(&release.tag_name, architecture);
    let asset = release
        .assets
        .into_iter()
        .find(|asset| asset.name == expected_asset_name)
        .with_context(|| format!("发布版本缺少便携版资产：{expected_asset_name}"))?;
    validate_update_size(asset.size)?;
    let sha256 = parse_sha256_digest(asset.digest.as_deref())?;
    let download_url = validate_download_url(&asset.browser_download_url)?;

    Ok(UpdateCandidate {
        version,
        tag_name: release.tag_name,
        published_at: release.published_at,
        notes: extract_release_notes(release.body.as_deref().unwrap_or_default()),
        asset_name: asset.name,
        size_bytes: asset.size,
        sha256,
        download_url,
    })
}

async fn send_request(
    url: &str,
    proxy_address: Option<&str>,
    timeout: Option<Duration>,
    accept: &str,
) -> Result<Response> {
    let mut failures = Vec::new();
    if let Some(proxy_address) = proxy_address {
        match build_client(Some(proxy_address), timeout) {
            Ok(client) => match client.get(url).header(ACCEPT, accept).send().await {
                Ok(response) if response.status().is_success() => return Ok(response),
                Ok(response) => failures.push(describe_http_failure("代理通道", &response)),
                Err(error) => failures.push(format!("代理通道：{error}")),
            },
            Err(error) => failures.push(format!("代理配置：{error}")),
        }
    }

    let direct_client = match build_client(None, timeout) {
        Ok(client) => client,
        Err(error) => {
            failures.push(format!("直连配置：{error}"));
            bail!("更新服务器请求失败：{}", failures.join("；"))
        }
    };
    match direct_client.get(url).header(ACCEPT, accept).send().await {
        Ok(response) if response.status().is_success() => Ok(response),
        Ok(response) => {
            failures.push(describe_http_failure("直连通道", &response));
            bail!("更新服务器请求失败：{}", failures.join("；"))
        }
        Err(error) => {
            failures.push(format!("直连通道：{error}"));
            bail!("更新服务器请求失败：{}", failures.join("；"))
        }
    }
}

fn describe_http_failure(channel: &str, response: &Response) -> String {
    let mut message = format!("{channel}返回 HTTP {}", response.status());
    let rate_limit_exhausted = response
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|value| value.to_str().ok())
        == Some("0");
    if rate_limit_exhausted {
        message.push_str("（GitHub API 访问额度已用尽）");
    }
    message
}

fn build_client(proxy_address: Option<&str>, timeout: Option<Duration>) -> Result<Client> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .user_agent(format!("Haruha/{} updater", env!("CARGO_PKG_VERSION")));
    builder = match proxy_address {
        Some(address) => builder.proxy(Proxy::all(address).context("更新代理地址无效")?),
        None => builder.no_proxy(),
    };
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    builder.build().context("创建更新网络客户端失败")
}

fn parse_release_version(tag_name: &str) -> Result<Version> {
    let normalized = tag_name.trim();
    let version = normalized
        .strip_prefix('v')
        .with_context(|| format!("发布标签必须以 v 开头：{tag_name}"))?;
    Version::parse(version).with_context(|| format!("发布版本号格式无效：{tag_name}"))
}

fn parse_sha256_digest(digest: Option<&str>) -> Result<String> {
    let digest = digest.context("发布资产缺少 SHA-256 摘要，已拒绝更新")?;
    let value = digest
        .strip_prefix("sha256:")
        .context("发布资产摘要不是 SHA-256")?
        .to_ascii_lowercase();
    validate_sha256(value, "发布资产 SHA-256 摘要格式无效")
}

fn parse_manifest_sha256(value: &str) -> Result<String> {
    validate_sha256(
        value.trim().to_ascii_lowercase(),
        "静态更新清单 SHA-256 格式无效",
    )
}

fn validate_sha256(value: String, message: &'static str) -> Result<String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!(message);
    }
    Ok(value)
}

fn expected_portable_asset_name(tag_name: &str, architecture: &str) -> String {
    format!("Haruha-{tag_name}-Windows-{architecture}-Portable.exe")
}

fn validate_update_size(size_bytes: u64) -> Result<()> {
    if size_bytes == 0 || size_bytes > MAX_UPDATE_BYTES {
        bail!("更新包大小异常：{size_bytes} 字节");
    }
    Ok(())
}

fn validate_download_url(value: &str) -> Result<String> {
    let url = Url::parse(value).context("更新包下载地址无效")?;
    if !url.username().is_empty() || url.password().is_some() {
        bail!("更新包下载地址不能包含登录信息");
    }
    let is_https = url.scheme() == "https";
    let is_loopback_http =
        url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "::1" | "localhost"));
    if !is_https && !is_loopback_http {
        bail!("更新包下载地址必须使用 HTTPS");
    }
    Ok(url.to_string())
}

fn normalize_notes(notes: Vec<String>) -> Vec<String> {
    notes
        .into_iter()
        .map(|note| note.trim().replace('`', ""))
        .filter(|note| !note.is_empty())
        .take(6)
        .collect()
}

#[cfg(target_arch = "x86_64")]
fn windows_architecture() -> Result<&'static str> {
    Ok("x64")
}

#[cfg(target_arch = "aarch64")]
fn windows_architecture() -> Result<&'static str> {
    Ok("ARM64")
}

#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
fn windows_architecture() -> Result<&'static str> {
    bail!("当前 Windows 架构暂无应用内更新包")
}

fn extract_release_notes(body: &str) -> Vec<String> {
    let mut notes = Vec::new();
    let mut in_chinese_changes = false;
    for raw_line in body.lines() {
        let line = raw_line.trim();
        if line == "#### 更新内容" {
            in_chinese_changes = true;
            continue;
        }
        if in_chinese_changes && line.starts_with('#') {
            break;
        }
        if in_chinese_changes {
            if let Some(note) = line.strip_prefix("- ") {
                notes.push(note.replace('`', ""));
                if notes.len() == 6 {
                    break;
                }
            }
        }
    }
    notes
}

fn emit_download_progress(
    app: &AppHandle,
    info: &UpdateInfo,
    downloaded_bytes: u64,
    elapsed: Duration,
) {
    let seconds = elapsed.as_secs_f64().max(0.001);
    let progress = UpdateDownloadProgress {
        version: info.version.clone(),
        downloaded_bytes,
        total_bytes: info.size_bytes,
        bytes_per_second: downloaded_bytes as f64 / seconds,
        percent: ((downloaded_bytes as f64 / info.size_bytes as f64) * 100.0).min(100.0),
    };
    let _ = app.emit(UPDATE_DOWNLOAD_PROGRESS_EVENT, progress);
}

fn update_dir() -> Result<PathBuf> {
    let base = dirs::data_local_dir().context("无法获取本地应用数据目录")?;
    Ok(base.join("Haruha").join("updates"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn sha256_file(path: &Path) -> Result<(String, u64)> {
    let file = File::open(path).with_context(|| format!("读取文件失败：{}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    let mut total = 0_u64;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        total = total.saturating_add(read as u64);
    }
    Ok((format!("{:x}", hasher.finalize()), total))
}

fn verify_executable(path: &Path, expected_sha256: &str, expected_size: u64) -> Result<()> {
    let mut file =
        File::open(path).with_context(|| format!("打开更新包失败：{}", path.display()))?;
    let mut header = [0_u8; 2];
    file.read_exact(&mut header).context("读取更新包头失败")?;
    if header != *b"MZ" {
        bail!("更新包不是有效的 Windows 可执行文件");
    }
    drop(file);
    let (actual_sha256, actual_size) = sha256_file(path)?;
    if actual_size != expected_size {
        bail!("更新包大小校验失败");
    }
    if actual_sha256 != expected_sha256 {
        bail!("更新包 SHA-256 校验失败");
    }
    Ok(())
}

pub fn take_last_apply_result() -> Result<Option<UpdateApplyResult>> {
    let path = update_dir()?.join(UPDATE_RESULT_FILE_NAME);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path)
        .with_context(|| format!("读取更新结果失败：{}", path.display()))?;
    let result = serde_json::from_str::<UpdateApplyResult>(&raw).context("解析更新结果失败")?;
    let _ = fs::remove_file(&path);
    Ok(Some(result))
}

pub fn schedule_helper_cleanup() {
    let Ok(directory) = update_dir() else {
        return;
    };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(6));
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if file_name.starts_with("Haruha-update-helper-") && file_name.ends_with(".exe") {
                let _ = fs::remove_file(entry.path());
            }
        }
    });
}

pub fn run_update_helper_if_requested() -> bool {
    let arguments = std::env::args_os().collect::<Vec<_>>();
    if arguments.get(1).and_then(|value| value.to_str()) != Some(UPDATE_HELPER_FLAG) {
        return false;
    }
    if let Err(error) = run_update_helper(&arguments) {
        eprintln!("应用便携版更新失败：{error:#}");
    }
    true
}

#[cfg(windows)]
fn run_update_helper(arguments: &[std::ffi::OsString]) -> Result<()> {
    if arguments.len() != 9 {
        bail!("更新助手参数不完整");
    }
    let parent_pid = arguments[2]
        .to_str()
        .context("父进程参数无效")?
        .parse::<u32>()
        .context("父进程编号无效")?;
    let staged_path = PathBuf::from(&arguments[3]);
    let target_path = PathBuf::from(&arguments[4]);
    let backup_path = PathBuf::from(&arguments[5]);
    let sha256 = arguments[6].to_str().context("SHA-256 参数无效")?;
    let version = arguments[7].to_str().context("版本参数无效")?;
    let result_path = PathBuf::from(&arguments[8]);

    let apply_result =
        apply_portable_update(parent_pid, &staged_path, &target_path, &backup_path, sha256);
    match apply_result {
        Ok(()) => write_apply_result(
            &result_path,
            UpdateApplyResult {
                success: true,
                version: version.to_string(),
                message: format!("已更新到 v{version}"),
                completed_at_ms: now_ms(),
            },
        ),
        Err(error) => {
            let update_error = format!("{error:#}");
            let restore_error = restore_backup(&target_path, &backup_path)
                .err()
                .map(|error| format!("恢复原程序失败：{error:#}"));
            let relaunch_error = if restore_error.is_none() {
                launch_application(&target_path)
                    .err()
                    .map(|error| format!("重新启动原程序失败：{error:#}"))
            } else {
                None
            };
            let recovery_error = restore_error.or(relaunch_error);
            let message = match recovery_error {
                Some(recovery_error) => {
                    format!("更新失败，且自动恢复没有完成：{update_error}；{recovery_error}")
                }
                None => format!("更新失败，已恢复原版本：{update_error}"),
            };
            let write_result = write_apply_result(
                &result_path,
                UpdateApplyResult {
                    success: false,
                    version: version.to_string(),
                    message: message.clone(),
                    completed_at_ms: now_ms(),
                },
            );
            if let Err(write_error) = write_result {
                eprintln!("记录更新失败结果失败：{write_error:#}");
            }
            bail!(message)
        }
    }
}

#[cfg(not(windows))]
fn run_update_helper(_arguments: &[std::ffi::OsString]) -> Result<()> {
    bail!("当前平台不支持便携版更新助手")
}

#[cfg(windows)]
fn apply_portable_update(
    parent_pid: u32,
    staged_path: &Path,
    target_path: &Path,
    backup_path: &Path,
    sha256: &str,
) -> Result<()> {
    let staged_size = fs::metadata(staged_path)
        .with_context(|| format!("读取更新包失败：{}", staged_path.display()))?
        .len();
    verify_executable(staged_path, sha256, staged_size)?;
    wait_for_process_exit(parent_pid, Duration::from_secs(30))?;

    if backup_path.exists() {
        fs::remove_file(backup_path)
            .with_context(|| format!("清理旧备份失败：{}", backup_path.display()))?;
    }
    fs::rename(target_path, backup_path).with_context(|| {
        format!(
            "备份当前程序失败：{} -> {}",
            target_path.display(),
            backup_path.display()
        )
    })?;

    if let Err(error) = copy_file_synced(staged_path, target_path)
        .and_then(|_| verify_executable(target_path, sha256, staged_size))
    {
        let _ = restore_backup(target_path, backup_path);
        return Err(error.context("替换程序失败"));
    }

    let mut child = launch_application(target_path).context("启动新版本失败")?;
    for _ in 0..12 {
        std::thread::sleep(Duration::from_millis(250));
        if let Some(status) = child.try_wait().context("检查新版本进程失败")? {
            let _ = restore_backup(target_path, backup_path);
            bail!("新版本启动后立即退出：{status}");
        }
    }

    let _ = fs::remove_file(backup_path);
    let _ = fs::remove_file(staged_path);
    Ok(())
}

#[cfg(windows)]
fn wait_for_process_exit(process_id: u32, timeout: Duration) -> Result<()> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT},
        System::Threading::{OpenProcess, WaitForSingleObject},
    };
    const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

    let process = unsafe { OpenProcess(SYNCHRONIZE_ACCESS, 0, process_id) };
    if process.is_null() {
        return Ok(());
    }
    let wait_result = unsafe { WaitForSingleObject(process, timeout.as_millis() as u32) };
    unsafe { CloseHandle(process) };
    match wait_result {
        WAIT_OBJECT_0 => Ok(()),
        WAIT_TIMEOUT => bail!("等待旧版本退出超时"),
        other => bail!("等待旧版本退出失败：{other}"),
    }
}

#[cfg(windows)]
fn copy_file_synced(source: &Path, target: &Path) -> Result<()> {
    let mut input = File::open(source)?;
    let mut output = File::create(target)?;
    std::io::copy(&mut input, &mut output)?;
    output.flush()?;
    output.sync_all()?;
    Ok(())
}

#[cfg(windows)]
fn launch_application(path: &Path) -> Result<std::process::Child> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(path);
    if let Some(directory) = path.parent() {
        command.current_dir(directory);
    }
    command
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .with_context(|| format!("启动程序失败：{}", path.display()))
}

#[cfg(windows)]
fn restore_backup(target_path: &Path, backup_path: &Path) -> Result<()> {
    if !backup_path.exists() {
        return Ok(());
    }
    if target_path.exists() {
        let _ = fs::remove_file(target_path);
    }
    fs::rename(backup_path, target_path).with_context(|| {
        format!(
            "恢复原程序失败：{} -> {}",
            backup_path.display(),
            target_path.display()
        )
    })
}

#[cfg(windows)]
fn write_apply_result(path: &Path, result: UpdateApplyResult) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("json.tmp");
    let raw = serde_json::to_vec_pretty(&result)?;
    let mut file = File::create(&temporary)?;
    file.write_all(&raw)?;
    file.flush()?;
    file.sync_all()?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spawn_http_response(
        status: u16,
        reason: &'static str,
        headers: impl Into<String>,
        body: impl Into<String>,
    ) -> (String, std::thread::JoinHandle<bool>) {
        let headers = headers.into();
        let body = body.into();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let handle = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let (mut stream, _) = loop {
                match listener.accept() {
                    Ok(connection) => break connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            return false;
                        }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("accept test request: {error}"),
                }
            };
            let mut request = [0_u8; 2_048];
            let _ = stream.read(&mut request);
            let response = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
            true
        });
        (format!("http://{address}/release"), handle)
    }

    fn manifest_body(schema_version: u32, version: &str) -> String {
        let tag_name = format!("v{version}");
        serde_json::json!({
            "schemaVersion": schema_version,
            "version": version,
            "tagName": tag_name,
            "publishedAt": "2026-08-18T08:00:00Z",
            "notes": ["静态清单更新"],
            "assets": [{
                "name": format!("Haruha-{tag_name}-Windows-x64-Portable.exe"),
                "architecture": "x64",
                "installKind": "portable",
                "sizeBytes": 1234,
                "sha256": "a".repeat(64),
                "downloadUrl": format!(
                    "https://github.com/Xiongdaxz/Haruha/releases/download/{tag_name}/Haruha-{tag_name}-Windows-x64-Portable.exe"
                )
            }]
        })
        .to_string()
    }

    fn github_release_body(version: &str) -> String {
        let tag_name = format!("v{version}");
        serde_json::json!({
            "tag_name": tag_name,
            "body": "#### 更新内容\n\n- API 备用渠道更新",
            "published_at": "2026-08-18T08:00:00Z",
            "draft": false,
            "prerelease": false,
            "assets": [{
                "name": format!("Haruha-{tag_name}-Windows-x64-Portable.exe"),
                "browser_download_url": format!(
                    "https://github.com/Xiongdaxz/Haruha/releases/download/{tag_name}/Haruha-{tag_name}-Windows-x64-Portable.exe"
                ),
                "size": 2345,
                "digest": format!("sha256:{}", "b".repeat(64))
            }]
        })
        .to_string()
    }

    fn unique_temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "haruha-updater-{name}-{}-{}",
            std::process::id(),
            now_ms()
        ))
    }

    #[test]
    fn parses_versions_and_strict_sha256_digests() {
        assert_eq!(
            parse_release_version("v0.1.4").unwrap(),
            Version::new(0, 1, 4)
        );
        assert!(parse_release_version("latest").is_err());
        assert!(parse_release_version("0.1.4").is_err());
        assert!(parse_release_version("vv0.1.4").is_err());
        let digest = format!("sha256:{}", "a".repeat(64));
        assert_eq!(parse_sha256_digest(Some(&digest)).unwrap(), "a".repeat(64));
        assert!(parse_sha256_digest(None).is_err());
        assert!(parse_sha256_digest(Some("md5:abc")).is_err());
    }

    #[test]
    fn extracts_only_chinese_update_notes() {
        let body = r#"### 中文

#### 更新内容

- 第一项更新
- 修复 `portable` 更新

#### 下载说明

- 不应出现

### English

- English entry
"#;
        assert_eq!(
            extract_release_notes(body),
            vec!["第一项更新", "修复 portable 更新"]
        );
    }

    #[test]
    fn prefers_a_valid_static_manifest_without_calling_the_api() {
        let (manifest_url, manifest_server) = spawn_http_response(
            200,
            "OK",
            "Content-Type: application/json\r\n",
            manifest_body(1, "9.1.0"),
        );
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let candidate = runtime
            .block_on(fetch_latest_update_from_urls(
                &manifest_url,
                "http://127.0.0.1:1/should-not-be-requested",
                None,
                "x64",
            ))
            .unwrap();

        assert_eq!(candidate.version, Version::new(9, 1, 0));
        assert_eq!(candidate.notes, vec!["静态清单更新"]);
        assert_eq!(candidate.size_bytes, 1234);
        assert!(manifest_server.join().unwrap());
    }

    #[test]
    fn falls_back_to_the_api_when_the_static_manifest_is_missing() {
        let (manifest_url, manifest_server) = spawn_http_response(404, "Not Found", "", "missing");
        let (api_url, api_server) = spawn_http_response(
            200,
            "OK",
            "Content-Type: application/json\r\n",
            github_release_body("9.2.0"),
        );
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let candidate = runtime
            .block_on(fetch_latest_update_from_urls(
                &manifest_url,
                &api_url,
                None,
                "x64",
            ))
            .unwrap();

        assert_eq!(candidate.version, Version::new(9, 2, 0));
        assert_eq!(candidate.notes, vec!["API 备用渠道更新"]);
        assert!(manifest_server.join().unwrap());
        assert!(api_server.join().unwrap());
    }

    #[test]
    fn falls_back_to_the_api_when_the_static_manifest_is_invalid() {
        let (manifest_url, manifest_server) = spawn_http_response(
            200,
            "OK",
            "Content-Type: application/json\r\n",
            manifest_body(2, "9.3.0"),
        );
        let (api_url, api_server) = spawn_http_response(
            200,
            "OK",
            "Content-Type: application/json\r\n",
            github_release_body("9.3.0"),
        );
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let candidate = runtime
            .block_on(fetch_latest_update_from_urls(
                &manifest_url,
                &api_url,
                None,
                "x64",
            ))
            .unwrap();

        assert_eq!(candidate.version, Version::new(9, 3, 0));
        assert!(manifest_server.join().unwrap());
        assert!(api_server.join().unwrap());
    }

    #[test]
    fn validates_pe_header_size_and_sha256() {
        let directory = unique_temp_dir("verify");
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("Haruha.exe");
        let payload = b"MZportable-update-test";
        fs::write(&path, payload).unwrap();
        let digest = format!("{:x}", Sha256::digest(payload));

        verify_executable(&path, &digest, payload.len() as u64).unwrap();
        assert!(verify_executable(&path, &"0".repeat(64), payload.len() as u64).is_err());
        assert!(verify_executable(&path, &digest, payload.len() as u64 + 1).is_err());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn falls_back_to_direct_after_proxy_http_failure() {
        let (direct_url, direct_server) = spawn_http_response(200, "OK", "", "direct");
        let (proxy_url, proxy_server) = spawn_http_response(
            403,
            "Forbidden",
            "X-RateLimit-Remaining: 0\r\n",
            "rate limited",
        );
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let response = runtime
            .block_on(send_request(
                &direct_url,
                Some(&proxy_url),
                Some(Duration::from_secs(3)),
                "application/json",
            ))
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert!(proxy_server.join().unwrap());
        assert!(direct_server.join().unwrap());
    }

    #[test]
    fn reports_proxy_and_direct_http_failures() {
        let (direct_url, direct_server) =
            spawn_http_response(503, "Service Unavailable", "", "unavailable");
        let (proxy_url, proxy_server) = spawn_http_response(
            403,
            "Forbidden",
            "X-RateLimit-Remaining: 0\r\n",
            "rate limited",
        );
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let error = runtime
            .block_on(send_request(
                &direct_url,
                Some(&proxy_url),
                Some(Duration::from_secs(3)),
                "application/json",
            ))
            .unwrap_err()
            .to_string();

        assert!(error.contains("代理通道返回 HTTP 403 Forbidden"));
        assert!(error.contains("GitHub API 访问额度已用尽"));
        assert!(error.contains("直连通道返回 HTTP 503 Service Unavailable"));
        assert!(proxy_server.join().unwrap());
        assert!(direct_server.join().unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn helper_restores_the_previous_executable_when_the_new_one_cannot_start() {
        let directory = unique_temp_dir("rollback");
        fs::create_dir_all(&directory).unwrap();
        let staged_path = directory.join("Haruha-new.exe");
        let target_path = directory.join("Haruha.exe");
        let backup_path = directory.join("Haruha.backup.exe");
        let result_path = directory.join("result.json");
        let staged_payload = b"MZnew-version-that-cannot-launch";
        let original_payload = b"MZoriginal-version";
        fs::write(&staged_path, staged_payload).unwrap();
        fs::write(&target_path, original_payload).unwrap();
        let digest = format!("{:x}", Sha256::digest(staged_payload));
        let arguments = vec![
            "helper.exe".into(),
            UPDATE_HELPER_FLAG.into(),
            u32::MAX.to_string().into(),
            staged_path.as_os_str().to_owned(),
            target_path.as_os_str().to_owned(),
            backup_path.as_os_str().to_owned(),
            digest.into(),
            "9.9.9".into(),
            result_path.as_os_str().to_owned(),
        ];

        assert!(run_update_helper(&arguments).is_err());
        assert_eq!(fs::read(&target_path).unwrap(), original_payload);
        assert!(!backup_path.exists());
        let result: UpdateApplyResult =
            serde_json::from_slice(&fs::read(&result_path).unwrap()).unwrap();
        assert!(!result.success);
        assert!(result.message.contains("更新失败"));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "需要访问 GitHub Release API"]
    fn live_release_api_matches_portable_update_contract() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let proxy_address = std::env::var("HARUHA_UPDATE_TEST_PROXY").ok();
        let architecture = windows_architecture().unwrap();
        let candidate = runtime
            .block_on(fetch_latest_update(proxy_address.as_deref(), architecture))
            .unwrap();
        assert_eq!(
            candidate.asset_name,
            expected_portable_asset_name(&candidate.tag_name, architecture)
        );
        assert!(candidate.size_bytes > 0);
        parse_manifest_sha256(&candidate.sha256)
            .expect("portable asset should have a valid SHA-256");
    }
}

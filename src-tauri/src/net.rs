use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use reqwest::{Client, Proxy};
use serde::Deserialize;

use crate::models::{IpInfo, ProxyProfile, SpeedTestConfig, SpeedTestResult, TestResult};

const MAX_DOWNLOAD_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct IpifyResponse {
    ip: String,
}

#[derive(Debug, Deserialize)]
struct IpInfoResponse {
    ip: Option<String>,
    city: Option<String>,
    region: Option<String>,
    country: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TencentIpResponse {
    ret: Option<i32>,
    ip: Option<String>,
    country: Option<String>,
    province: Option<String>,
    city: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IfconfigResponse {
    ip: Option<String>,
    city: Option<String>,
    region_name: Option<String>,
    country: Option<String>,
}

pub async fn test_proxy(profile: &ProxyProfile) -> TestResult {
    let started = Instant::now();
    let proxy = match Proxy::all(format!("http://{}", profile.address())) {
        Ok(proxy) => proxy,
        Err(error) => {
            return TestResult {
                ok: false,
                latency_ms: None,
                message: format!("代理地址无效: {error}"),
            };
        }
    };

    let client = match Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(8))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return TestResult {
                ok: false,
                latency_ms: None,
                message: format!("创建代理测试客户端失败: {error}"),
            };
        }
    };

    match client
        .get("https://www.google.com/generate_204")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() || response.status().as_u16() == 204 => {
            TestResult {
                ok: true,
                latency_ms: Some(started.elapsed().as_millis()),
                message: "代理连接测试成功".to_string(),
            }
        }
        Ok(response) => TestResult {
            ok: false,
            latency_ms: Some(started.elapsed().as_millis()),
            message: format!("代理测试失败，HTTP {}", response.status()),
        },
        Err(error) => TestResult {
            ok: false,
            latency_ms: Some(started.elapsed().as_millis()),
            message: format!("代理测试失败: {error}"),
        },
    }
}

pub async fn refresh_ip_info(profile: &ProxyProfile, use_proxy: bool) -> Result<IpInfo> {
    let started = Instant::now();
    let mut builder = Client::builder().timeout(Duration::from_secs(5));
    if use_proxy {
        builder = builder.proxy(Proxy::all(format!("http://{}", profile.address()))?);
    } else {
        builder = builder.no_proxy();
    }
    let client = builder.build()?;

    if use_proxy {
        fetch_proxy_ip_info(&client, started).await
    } else {
        fetch_direct_ip_info(&client, started).await
    }
}

pub async fn run_proxy_speed_test(
    profile: &ProxyProfile,
    config: &SpeedTestConfig,
) -> SpeedTestResult {
    let total_started = Instant::now();
    let download_url = config.download_url.trim();
    if !is_http_url(download_url) {
        return speed_failure(total_started, "下载测速地址必须以 http:// 或 https:// 开头");
    }

    let proxy = match Proxy::all(format!("http://{}", profile.address())) {
        Ok(proxy) => proxy,
        Err(error) => return speed_failure(total_started, &format!("代理地址无效: {error}")),
    };

    let client = match Client::builder()
        .proxy(proxy)
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(client) => client,
        Err(error) => return speed_failure(total_started, &format!("创建测速客户端失败: {error}")),
    };

    let download_limit = config
        .download_bytes_limit
        .clamp(128 * 1024, MAX_DOWNLOAD_BYTES);
    let download_started = Instant::now();
    let mut response = match client.get(download_url).send().await {
        Ok(response) => response,
        Err(error) => return speed_failure(total_started, &format!("下载测速失败: {error}")),
    };
    let latency_ms = download_started.elapsed().as_millis();
    if !response.status().is_success() {
        return speed_failure(
            total_started,
            &format!("下载测速失败，HTTP {}", response.status()),
        );
    }

    let mut downloaded_bytes = 0_u64;
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                downloaded_bytes += chunk.len() as u64;
                if downloaded_bytes >= download_limit {
                    break;
                }
            }
            Ok(None) => break,
            Err(error) => {
                return speed_failure(total_started, &format!("读取测速数据失败: {error}"))
            }
        }
    }

    if downloaded_bytes == 0 {
        return speed_failure(total_started, "下载测速地址未返回数据");
    }

    let download_duration = download_started.elapsed();
    let download_mbps = mbps(downloaded_bytes, download_duration);

    SpeedTestResult {
        ok: true,
        latency_ms: Some(latency_ms),
        download_mbps: Some(download_mbps),
        downloaded_bytes: Some(downloaded_bytes),
        duration_ms: total_started.elapsed().as_millis(),
        message: String::new(),
    }
}

async fn fetch_ipinfo(client: &Client, started: Instant) -> Result<IpInfo> {
    let response = client
        .get("https://ipinfo.io/json")
        .send()
        .await?
        .json::<IpInfoResponse>()
        .await?;

    let ip = response.ip.context("ipinfo.io 未返回IP")?;
    let location = [response.city, response.region, response.country]
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(", ");

    Ok(IpInfo {
        ip,
        location: if location.is_empty() {
            "位置未知".to_string()
        } else {
            location
        },
        latency_ms: Some(started.elapsed().as_millis()),
        source: "ipinfo.io".to_string(),
    })
}

async fn fetch_direct_ip_info(client: &Client, started: Instant) -> Result<IpInfo> {
    if let Ok(info) = fetch_tencent_ip2city(client, started).await {
        return Ok(info);
    }
    if let Ok(info) = fetch_myip_ipip(client, started).await {
        return Ok(info);
    }
    if let Ok(info) = fetch_ipinfo(client, started).await {
        return Ok(info);
    }
    fetch_ipify(client, started).await
}

async fn fetch_proxy_ip_info(client: &Client, started: Instant) -> Result<IpInfo> {
    if let Ok(info) = fetch_ipinfo(client, started).await {
        return Ok(info);
    }
    if let Ok(info) = fetch_ifconfig(client, started).await {
        return Ok(info);
    }
    fetch_ipify(client, started).await
}

async fn fetch_tencent_ip2city(client: &Client, started: Instant) -> Result<IpInfo> {
    let response = client
        .get("https://r.inews.qq.com/api/ip2city?otype=json")
        .send()
        .await?
        .json::<TencentIpResponse>()
        .await?;

    if response.ret != Some(0) {
        anyhow::bail!("腾讯IP查询接口返回失败");
    }

    let ip = clean_required_value(response.ip, "腾讯IP查询接口未返回IP")?;
    if ip.contains(':') {
        anyhow::bail!("腾讯IP查询接口返回IPv6，跳过");
    }

    Ok(IpInfo {
        ip,
        location: join_location([response.country, response.province, response.city], " "),
        latency_ms: Some(started.elapsed().as_millis()),
        source: "r.inews.qq.com".to_string(),
    })
}

async fn fetch_myip_ipip(client: &Client, started: Instant) -> Result<IpInfo> {
    let content = client
        .get("https://myip.ipip.net/")
        .send()
        .await?
        .text()
        .await?;
    let (ip, location) = parse_myip_ipip(&content)?;

    Ok(IpInfo {
        ip,
        location,
        latency_ms: Some(started.elapsed().as_millis()),
        source: "myip.ipip.net".to_string(),
    })
}

async fn fetch_ifconfig(client: &Client, started: Instant) -> Result<IpInfo> {
    let response = client
        .get("https://ifconfig.co/json")
        .send()
        .await?
        .json::<IfconfigResponse>()
        .await?;

    Ok(IpInfo {
        ip: clean_required_value(response.ip, "ifconfig.co 未返回IP")?,
        location: join_location(
            [response.city, response.region_name, response.country],
            ", ",
        ),
        latency_ms: Some(started.elapsed().as_millis()),
        source: "ifconfig.co".to_string(),
    })
}

async fn fetch_ipify(client: &Client, started: Instant) -> Result<IpInfo> {
    let response = client
        .get("https://api.ipify.org?format=json")
        .send()
        .await
        .context("获取IP信息失败")?
        .json::<IpifyResponse>()
        .await
        .context("解析IP信息失败")?;

    Ok(IpInfo {
        ip: response.ip,
        location: "位置未知".to_string(),
        latency_ms: Some(started.elapsed().as_millis()),
        source: "api.ipify.org".to_string(),
    })
}

pub fn proxy_disabled_ip_info() -> IpInfo {
    IpInfo {
        ip: "未启用代理".to_string(),
        location: String::new(),
        latency_ms: None,
        source: "proxy-disabled".to_string(),
    }
}

fn parse_myip_ipip(content: &str) -> Result<(String, String)> {
    let ip = content
        .split("当前 IP：")
        .nth(1)
        .and_then(|value| value.split_whitespace().next())
        .map(|value| value.trim().trim_matches('，').to_string())
        .filter(|value| !value.is_empty())
        .context("myip.ipip.net 未返回IP")?;

    let location = content
        .split("来自于：")
        .nth(1)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("位置未知")
        .to_string();

    Ok((ip, location))
}

fn clean_required_value(value: Option<String>, error: &'static str) -> Result<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "未知")
        .context(error)
}

fn join_location(parts: impl IntoIterator<Item = Option<String>>, separator: &str) -> String {
    let values = parts
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && value != "未知")
        .collect::<Vec<_>>();

    if values.is_empty() {
        "位置未知".to_string()
    } else {
        values.join(separator)
    }
}

fn is_http_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

fn mbps(bytes: u64, duration: Duration) -> f64 {
    let seconds = duration.as_secs_f64().max(0.001);
    ((bytes as f64) * 8.0) / seconds / 1_000_000.0
}

fn speed_failure(started: Instant, message: &str) -> SpeedTestResult {
    SpeedTestResult {
        ok: false,
        latency_ms: None,
        download_mbps: None,
        downloaded_bytes: None,
        duration_ms: started.elapsed().as_millis(),
        message: message.to_string(),
    }
}

use std::{path::Path, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Utc};
#[cfg(any(debug_assertions, test))]
use chrono::{Datelike, TimeZone};
use futures::StreamExt;
use reqwest::{header::DATE, Body, Client, Response, StatusCode};
use tempfile::{NamedTempFile, TempPath};
use tokio::io::AsyncWriteExt;
use tokio::time::sleep;
use tokio_util::io::ReaderStream;

const SHRINK_URL: &str = "https://api.tinify.com/shrink";
const MAX_RETRIES: usize = 2;

#[derive(Debug, thiserror::Error)]
pub enum TinifyError {
    #[error("TinyPNG Key 无效")]
    InvalidKey,
    #[error("TinyPNG Key 本自然月容量已用尽")]
    CapacityExhausted(u32),
    #[error("授权已到期（已通过 TinyPNG 服务器时间校验）")]
    LicenseExpired,
    #[error("TinyPNG 请求失败：{0}")]
    Request(String),
}

#[derive(Debug)]
pub struct TinifyOutput {
    pub compressed_size: u64,
    pub compression_count: Option<u32>,
    pub server_time: Option<DateTime<Utc>>,
}

#[cfg(any(debug_assertions, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageStatus {
    Active,
    Exhausted,
    Invalid,
    Unavailable,
}

#[cfg(any(debug_assertions, test))]
impl UsageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Exhausted => "exhausted",
            Self::Invalid => "invalid",
            Self::Unavailable => "unavailable",
        }
    }
}

#[cfg(any(debug_assertions, test))]
#[derive(Debug, Clone)]
pub struct UsageSnapshot {
    pub count: Option<u32>,
    pub status: UsageStatus,
    pub observed_at: DateTime<Utc>,
    pub message: Option<String>,
}

fn compression_count(response: &Response) -> Option<u32> {
    response
        .headers()
        .get("Compression-Count")?
        .to_str()
        .ok()?
        .parse()
        .ok()
}

fn server_time(response: &Response) -> Option<DateTime<Utc>> {
    response
        .headers()
        .get(DATE)?
        .to_str()
        .ok()
        .and_then(|value| DateTime::parse_from_rfc2822(value).ok())
        .map(|value| value.with_timezone(&Utc))
}

fn authorization(api_key: &str) -> String {
    format!("Basic {}", STANDARD.encode(format!("api:{api_key}")))
}

#[cfg(any(debug_assertions, test))]
fn next_month_reset(observed_at: DateTime<Utc>) -> DateTime<Utc> {
    let (year, month) = if observed_at.month() == 12 {
        (observed_at.year() + 1, 1)
    } else {
        (observed_at.year(), observed_at.month() + 1)
    };
    Utc.with_ymd_and_hms(year, month, 1, 0, 0, 0)
        .single()
        .expect("有效的下一个自然月起点")
}

/// TinyPNG 官方客户端以空 POST /shrink 校验 Key；400 Input missing 是有效校验响应，不会上传图片或计费。
#[cfg(any(debug_assertions, test))]
pub async fn query_usage(client: &Client, api_key: &str) -> UsageSnapshot {
    query_usage_with_endpoint(client, api_key, SHRINK_URL).await
}

#[cfg(any(debug_assertions, test))]
async fn query_usage_with_endpoint(
    client: &Client,
    api_key: &str,
    endpoint: &str,
) -> UsageSnapshot {
    let response = match client
        .post(endpoint)
        .header("Authorization", authorization(api_key))
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            let observed_at = Utc::now();
            return UsageSnapshot {
                count: None,
                status: UsageStatus::Unavailable,
                observed_at,
                message: Some("无法连接 TinyPNG，请稍后重试".into()),
            };
        }
    };
    let count = compression_count(&response);
    let observed_at = server_time(&response).unwrap_or_else(Utc::now);
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED {
        return UsageSnapshot {
            count: None,
            status: UsageStatus::Invalid,
            observed_at,
            message: Some("TinyPNG 未接受此 Token".into()),
        };
    }
    if status == StatusCode::TOO_MANY_REQUESTS && count.is_some_and(|value| value >= 500) {
        return UsageSnapshot {
            count,
            status: UsageStatus::Exhausted,
            observed_at,
            message: None,
        };
    }
    // 空请求预期为 400 Input missing；该响应证明 Key 有效，且 Compression-Count 是本自然月真实计数。
    if status == StatusCode::BAD_REQUEST || status.is_success() {
        return UsageSnapshot {
            count,
            status: match count {
                Some(value) if value >= 500 => UsageStatus::Exhausted,
                Some(_) => UsageStatus::Active,
                None => UsageStatus::Unavailable,
            },
            observed_at,
            message: count.is_none().then(|| "TinyPNG 未返回当月使用计数".into()),
        };
    }
    UsageSnapshot {
        count,
        status: UsageStatus::Unavailable,
        observed_at,
        message: Some(format!("TinyPNG 暂时无法查询（HTTP {}）", status.as_u16())),
    }
}

#[cfg(any(debug_assertions, test))]
pub fn monthly_reset_at(observed_at: DateTime<Utc>) -> DateTime<Utc> {
    next_month_reset(observed_at)
}

fn retryable(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

async fn retry_delay(attempt: usize) {
    sleep(Duration::from_millis(300 * 2_u64.pow(attempt as u32))).await;
}

fn response_error(
    response: Response,
    action: &str,
) -> impl std::future::Future<Output = TinifyError> {
    let action = action.to_string();
    async move {
        let status = response.status();
        let message = response.text().await.unwrap_or_default();
        TinifyError::Request(format!(
            "{} {} {}",
            action,
            status.as_u16(),
            message.chars().take(160).collect::<String>()
        ))
    }
}

async fn upload(
    client: &Client,
    api_key: &str,
    source: &Path,
    shrink_url: &str,
) -> std::result::Result<(String, Option<u32>, Option<DateTime<Utc>>), TinifyError> {
    let authorization = authorization(api_key);
    for attempt in 0..=MAX_RETRIES {
        // 每次重试重新打开文件：流式请求体不可复用，但不再把整张图片复制到内存。
        let file = tokio::fs::File::open(source)
            .await
            .map_err(|error| TinifyError::Request(format!("读取原图失败：{error}")))?;
        let body = Body::wrap_stream(ReaderStream::new(file));
        let response = client
            .post(shrink_url)
            .header("Authorization", &authorization)
            .body(body)
            .send()
            .await
            .map_err(|error| TinifyError::Request(error.to_string()))?;
        let count = compression_count(&response);
        let observed_at = server_time(&response);
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(TinifyError::InvalidKey);
        }
        if response.status() == StatusCode::TOO_MANY_REQUESTS
            && count.is_some_and(|value| value >= 500)
        {
            return Err(TinifyError::CapacityExhausted(count.unwrap_or(500)));
        }
        if retryable(response.status()) && attempt < MAX_RETRIES {
            retry_delay(attempt).await;
            continue;
        }
        if !response.status().is_success() {
            return Err(response_error(response, "上传失败").await);
        }
        let location = response
            .headers()
            .get("Location")
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| TinifyError::Request("上传响应缺少 Location".into()))?;
        return Ok((location.to_string(), count, observed_at));
    }
    Err(TinifyError::Request("上传重试次数已用尽".into()))
}

async fn persist_temp_file(
    temp_path: TempPath,
    destination: &Path,
    overwrite: bool,
) -> std::result::Result<(), TinifyError> {
    let destination = destination.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let result = if overwrite {
            temp_path.persist(&destination)
        } else {
            temp_path.persist_noclobber(&destination)
        };
        result.map_err(|error| {
            if !overwrite && error.error.kind() == std::io::ErrorKind::AlreadyExists {
                TinifyError::Request("目标文件已存在".into())
            } else {
                TinifyError::Request(format!("无法原子写入输出文件：{}", error.error))
            }
        })
    })
    .await
    .map_err(|error| TinifyError::Request(format!("输出写入任务异常：{error}")))?
}

async fn download_to_file(
    client: &Client,
    api_key: &str,
    location: &str,
    destination: &Path,
    overwrite: bool,
    expires_at: Option<DateTime<Utc>>,
    fallback_server_time: Option<DateTime<Utc>>,
) -> std::result::Result<TinifyOutput, TinifyError> {
    let authorization = authorization(api_key);
    for attempt in 0..=MAX_RETRIES {
        let response = client
            .get(location)
            .header("Authorization", &authorization)
            .send()
            .await
            .map_err(|error| TinifyError::Request(error.to_string()))?;
        let count = compression_count(&response);
        let observed_at = server_time(&response);
        if response.status() == StatusCode::UNAUTHORIZED {
            return Err(TinifyError::InvalidKey);
        }
        if response.status() == StatusCode::TOO_MANY_REQUESTS
            && count.is_some_and(|value| value >= 500)
        {
            return Err(TinifyError::CapacityExhausted(count.unwrap_or(500)));
        }
        if retryable(response.status()) && attempt < MAX_RETRIES {
            retry_delay(attempt).await;
            continue;
        }
        if !response.status().is_success() {
            return Err(response_error(response, "下载结果失败").await);
        }

        let parent = destination
            .parent()
            .ok_or_else(|| TinifyError::Request("输出路径无效".into()))?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| TinifyError::Request(format!("无法创建输出目录：{error}")))?;
        let (file, temp_path) = NamedTempFile::new_in(parent)
            .map_err(|error| TinifyError::Request(format!("无法创建临时文件：{error}")))?
            .into_parts();
        let mut file = tokio::fs::File::from_std(file);
        let mut stream = response.bytes_stream();
        let mut compressed_size = 0_u64;
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|error| TinifyError::Request(format!("下载结果失败：{error}")))?;
            file.write_all(&chunk)
                .await
                .map_err(|error| TinifyError::Request(format!("写入临时文件失败：{error}")))?;
            compressed_size = compressed_size.saturating_add(chunk.len() as u64);
        }
        file.flush()
            .await
            .map_err(|error| TinifyError::Request(format!("刷新输出文件失败：{error}")))?;
        file.sync_all()
            .await
            .map_err(|error| TinifyError::Request(format!("同步输出文件失败：{error}")))?;
        drop(file);
        if observed_at
            .or(fallback_server_time)
            .is_some_and(|time| expires_at.is_some_and(|expires_at| time >= expires_at))
        {
            return Err(TinifyError::LicenseExpired);
        }
        persist_temp_file(temp_path, destination, overwrite).await?;
        return Ok(TinifyOutput {
            compressed_size,
            compression_count: count,
            server_time: observed_at,
        });
    }
    Err(TinifyError::Request("下载重试次数已用尽".into()))
}

pub async fn compress_to_file<F>(
    client: &Client,
    api_key: &str,
    source: &Path,
    destination: &Path,
    overwrite: bool,
    expires_at: DateTime<Utc>,
    mut on_stage: F,
) -> std::result::Result<TinifyOutput, TinifyError>
where
    F: FnMut(&'static str),
{
    on_stage("reading");
    on_stage("uploading");
    let (location, upload_count, upload_time) = upload(client, api_key, source, SHRINK_URL).await?;
    on_stage("downloading");
    let mut output = download_to_file(
        client,
        api_key,
        &location,
        destination,
        overwrite,
        Some(expires_at),
        upload_time,
    )
    .await?;
    on_stage("writing");
    if output.compression_count.is_none() {
        output.compression_count = upload_count;
    }
    if output.server_time.is_none() {
        output.server_time = upload_time;
    }
    Ok(output)
}

#[cfg(test)]
async fn compress_to_file_with_endpoint(
    client: &Client,
    api_key: &str,
    source: &Path,
    destination: &Path,
    shrink_url: &str,
) -> std::result::Result<TinifyOutput, TinifyError> {
    let (location, upload_count, upload_time) = upload(client, api_key, source, shrink_url).await?;
    let mut output = download_to_file(
        client,
        api_key,
        &location,
        destination,
        false,
        None,
        upload_time,
    )
    .await?;
    if output.compression_count.is_none() {
        output.compression_count = upload_count;
    }
    if output.server_time.is_none() {
        output.server_time = upload_time;
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use std::{fs, time::Instant};

    use httpmock::prelude::*;
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn follows_location_streams_result_and_parses_compression_count() {
        let server = MockServer::start();
        let download_url = server.url("/result");
        let upload = server.mock(|when, then| {
            when.method(POST)
                .path("/shrink")
                .header_exists("authorization");
            then.status(201)
                .header("Location", &download_url)
                .header("Compression-Count", "42")
                .header("Date", "Tue, 14 Jul 2026 03:00:00 GMT");
        });
        let download = server.mock(|when, then| {
            when.method(GET)
                .path("/result")
                .header_exists("authorization");
            then.status(200)
                .header("Date", "Tue, 14 Jul 2026 03:00:00 GMT")
                .body("compressed");
        });
        let temp = tempdir().unwrap();
        let source = temp.path().join("image.png");
        let destination = temp.path().join("result.png");
        fs::write(&source, b"source").unwrap();

        let output = compress_to_file_with_endpoint(
            &Client::new(),
            "secret",
            &source,
            &destination,
            &server.url("/shrink"),
        )
        .await
        .unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"compressed");
        assert_eq!(output.compressed_size, 10);
        assert_eq!(output.compression_count, Some(42));
        assert_eq!(
            output.server_time.unwrap().to_rfc3339(),
            "2026-07-14T03:00:00+00:00"
        );
        upload.assert();
        download.assert();
    }

    #[tokio::test]
    async fn reads_monthly_usage_from_the_zero_input_key_validation_response() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST)
                .path("/shrink")
                .header_exists("authorization");
            then.status(400)
                .header("Compression-Count", "214")
                .header("Date", "Tue, 14 Jul 2026 03:00:00 GMT")
                .body(r#"{"error":"Input missing","message":"No input"}"#);
        });

        let usage =
            query_usage_with_endpoint(&Client::new(), "secret", &server.url("/shrink")).await;

        assert_eq!(usage.count, Some(214));
        assert_eq!(usage.status, UsageStatus::Active);
        assert_eq!(
            monthly_reset_at(usage.observed_at).to_rfc3339(),
            "2026-08-01T00:00:00+00:00"
        );
        request.assert();
    }

    #[tokio::test]
    async fn reports_invalid_keys_without_returning_the_key_material() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST)
                .path("/shrink")
                .header_exists("authorization");
            then.status(401)
                .header("Date", "Tue, 14 Jul 2026 03:00:00 GMT")
                .body(r#"{"error":"Unauthorized"}"#);
        });

        let usage =
            query_usage_with_endpoint(&Client::new(), "secret", &server.url("/shrink")).await;

        assert_eq!(usage.status, UsageStatus::Invalid);
        assert_eq!(usage.count, None);
        assert!(!usage.message.unwrap_or_default().contains("secret"));
    }

    #[tokio::test]
    async fn keeps_existing_output_when_non_overwrite_commit_collides() {
        let server = MockServer::start();
        let download_url = server.url("/result");
        server.mock(|when, then| {
            when.method(POST).path("/shrink");
            then.status(201).header("Location", &download_url);
        });
        server.mock(|when, then| {
            when.method(GET).path("/result");
            then.status(200).body("compressed");
        });
        let temp = tempdir().unwrap();
        let source = temp.path().join("image.png");
        let destination = temp.path().join("result.png");
        fs::write(&source, b"source").unwrap();
        fs::write(&destination, b"original").unwrap();

        let error = compress_to_file_with_endpoint(
            &Client::new(),
            "secret",
            &source,
            &destination,
            &server.url("/shrink"),
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("目标文件已存在"));
        assert_eq!(fs::read(destination).unwrap(), b"original");
    }

    #[tokio::test]
    async fn refuses_to_commit_when_tinypng_server_time_is_expired() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/result");
            then.status(200)
                .header("Date", "Tue, 14 Jul 2026 03:00:00 GMT")
                .body("compressed");
        });
        let temp = tempdir().unwrap();
        let destination = temp.path().join("result.png");
        let expires_at = DateTime::parse_from_rfc3339("2026-07-14T02:59:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let error = download_to_file(
            &Client::new(),
            "secret",
            &server.url("/result"),
            &destination,
            false,
            Some(expires_at),
            None,
        )
        .await
        .unwrap_err();
        assert!(matches!(error, TinifyError::LicenseExpired));
        assert!(!destination.exists());
    }

    #[tokio::test]
    async fn streams_large_image_without_client_overhead_over_five_seconds() {
        const SOURCE_SIZE: usize = 16 * 1024 * 1024;
        const OUTPUT_SIZE: usize = 8 * 1024 * 1024;
        const REMOTE_DELAY: Duration = Duration::from_millis(250);
        const MAX_CLIENT_OVERHEAD: Duration = Duration::from_secs(5);

        let server = MockServer::start();
        let download_url = server.url("/result");
        server.mock(|when, then| {
            when.method(POST).path("/shrink");
            then.status(201)
                .delay(REMOTE_DELAY)
                .header("Location", &download_url);
        });
        let compressed = vec![0x5a; OUTPUT_SIZE];
        server.mock(move |when, then| {
            when.method(GET).path("/result");
            then.status(200).delay(REMOTE_DELAY).body(compressed);
        });
        let temp = tempdir().unwrap();
        let source = temp.path().join("large-source.png");
        let destination = temp.path().join("large-output.png");
        fs::write(&source, vec![0xa5; SOURCE_SIZE]).unwrap();

        let started = Instant::now();
        let result = compress_to_file_with_endpoint(
            &Client::new(),
            "secret",
            &source,
            &destination,
            &server.url("/shrink"),
        )
        .await
        .unwrap();
        let total = started.elapsed();
        let simulated_tinypng = REMOTE_DELAY * 2;
        let client_overhead = total.saturating_sub(simulated_tinypng);

        eprintln!(
            "streaming 16MB→8MB: total={total:?}, simulated_tinypng={simulated_tinypng:?}, client_overhead={client_overhead:?}"
        );
        assert!(
            client_overhead < MAX_CLIENT_OVERHEAD,
            "客户端额外耗时 {client_overhead:?} 超过 5 秒门槛"
        );
        assert_eq!(result.compressed_size, OUTPUT_SIZE as u64);
        assert_eq!(fs::metadata(destination).unwrap().len(), OUTPUT_SIZE as u64);
    }

    #[tokio::test]
    async fn rejects_missing_location_header() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/shrink");
            then.status(201);
        });
        let temp = tempdir().unwrap();
        let source = temp.path().join("image.png");
        fs::write(&source, b"source").unwrap();
        let error = upload(&Client::new(), "secret", &source, &server.url("/shrink"))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Location"));
    }

    #[tokio::test]
    async fn marks_unauthorized_key_invalid() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/shrink");
            then.status(401);
        });
        let temp = tempdir().unwrap();
        let source = temp.path().join("image.png");
        fs::write(&source, b"source").unwrap();
        let error = upload(&Client::new(), "secret", &source, &server.url("/shrink"))
            .await
            .unwrap_err();
        assert!(matches!(error, TinifyError::InvalidKey));
    }

    #[tokio::test]
    async fn retries_server_errors_twice() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST).path("/shrink");
            then.status(503);
        });
        let temp = tempdir().unwrap();
        let source = temp.path().join("image.png");
        fs::write(&source, b"source").unwrap();
        let _ = upload(&Client::new(), "secret", &source, &server.url("/shrink")).await;
        assert_eq!(request.calls(), 3);
    }

    #[tokio::test]
    async fn reports_monthly_capacity_from_429_header() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/shrink");
            then.status(429).header("Compression-Count", "500");
        });
        let temp = tempdir().unwrap();
        let source = temp.path().join("image.png");
        fs::write(&source, b"source").unwrap();
        let error = upload(&Client::new(), "secret", &source, &server.url("/shrink"))
            .await
            .unwrap_err();
        assert!(matches!(error, TinifyError::CapacityExhausted(500)));
    }
}

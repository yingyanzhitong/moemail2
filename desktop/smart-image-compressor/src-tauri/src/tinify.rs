use std::{io::Write, path::PathBuf, time::Duration};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Utc};
use reqwest::{header::DATE, Client, Response, StatusCode};
use tokio::time::sleep;

const SHRINK_URL: &str = "https://api.tinify.com/shrink";
const MAX_RETRIES: usize = 2;

#[derive(Debug, thiserror::Error)]
pub enum TinifyError {
    #[error("TinyPNG Key 无效")]
    InvalidKey,
    #[error("TinyPNG Key 本自然月容量已用尽")]
    CapacityExhausted(u32),
    #[error("TinyPNG 请求失败：{0}")]
    Request(String),
}

#[derive(Debug)]
pub struct TinifyOutput {
    pub bytes: Vec<u8>,
    pub compression_count: Option<u32>,
    pub server_time: Option<DateTime<Utc>>,
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

fn retryable(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

async fn retry_delay(attempt: usize) {
    sleep(Duration::from_millis(300 * 2_u64.pow(attempt as u32))).await;
}

async fn upload(
    client: &Client,
    api_key: &str,
    body: Vec<u8>,
    shrink_url: &str,
) -> std::result::Result<(String, Option<u32>, Option<DateTime<Utc>>), TinifyError> {
    let authorization = format!("Basic {}", STANDARD.encode(format!("api:{api_key}")));
    for attempt in 0..=MAX_RETRIES {
        let response = client
            .post(shrink_url)
            .header("Authorization", &authorization)
            .body(body.clone())
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
            let status = response.status();
            let message = response.text().await.unwrap_or_default();
            return Err(TinifyError::Request(format!(
                "{} {}",
                status.as_u16(),
                message.chars().take(160).collect::<String>()
            )));
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

async fn download(
    client: &Client,
    api_key: &str,
    location: &str,
) -> std::result::Result<TinifyOutput, TinifyError> {
    let authorization = format!("Basic {}", STANDARD.encode(format!("api:{api_key}")));
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
            return Err(TinifyError::Request(format!(
                "下载结果失败：{}",
                response.status().as_u16()
            )));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| TinifyError::Request(error.to_string()))?
            .to_vec();
        return Ok(TinifyOutput {
            bytes,
            compression_count: count,
            server_time: observed_at,
        });
    }
    Err(TinifyError::Request("下载重试次数已用尽".into()))
}

pub async fn compress(
    client: &Client,
    api_key: &str,
    source: &std::path::Path,
) -> std::result::Result<TinifyOutput, TinifyError> {
    compress_with_endpoint(client, api_key, source, SHRINK_URL).await
}

async fn compress_with_endpoint(
    client: &Client,
    api_key: &str,
    source: &std::path::Path,
    shrink_url: &str,
) -> std::result::Result<TinifyOutput, TinifyError> {
    let body = tokio::fs::read(source)
        .await
        .map_err(|error| TinifyError::Request(format!("读取原图失败：{error}")))?;
    let (location, upload_count, upload_time) = upload(client, api_key, body, shrink_url).await?;
    let mut output = download(client, api_key, &location).await?;
    if output.compression_count.is_none() {
        output.compression_count = upload_count;
    }
    if output.server_time.is_none() {
        output.server_time = upload_time;
    }
    Ok(output)
}

pub async fn atomic_write(path: &std::path::Path, bytes: Vec<u8>, overwrite: bool) -> Result<()> {
    let path = PathBuf::from(path);
    tokio::task::spawn_blocking(move || -> Result<()> {
        let parent = path.parent().context("输出路径无效")?;
        std::fs::create_dir_all(parent).context("无法创建输出目录")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).context("无法创建临时文件")?;
        temporary.write_all(&bytes).context("无法写入临时文件")?;
        temporary.as_file().sync_all().context("无法同步临时文件")?;
        if overwrite {
            temporary
                .persist(&path)
                .map_err(|error| error.error)
                .context("无法原子覆盖原文件")?;
        } else {
            temporary.persist_noclobber(&path).map_err(|error| {
                if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                    anyhow!("目标文件已存在")
                } else {
                    anyhow!("无法原子写入输出文件：{}", error.error)
                }
            })?;
        }
        Ok(())
    })
    .await
    .context("输出写入任务异常")??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use httpmock::prelude::*;
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn follows_location_and_parses_compression_count() {
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
        fs::write(&source, b"source").unwrap();

        let output =
            compress_with_endpoint(&Client::new(), "secret", &source, &server.url("/shrink"))
                .await
                .unwrap();
        assert_eq!(output.bytes, b"compressed");
        assert_eq!(output.compression_count, Some(42));
        assert_eq!(
            output.server_time.unwrap().to_rfc3339(),
            "2026-07-14T03:00:00+00:00"
        );
        upload.assert();
        download.assert();
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
        let error =
            compress_with_endpoint(&Client::new(), "secret", &source, &server.url("/shrink"))
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
        let error =
            compress_with_endpoint(&Client::new(), "secret", &source, &server.url("/shrink"))
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
        let _ =
            compress_with_endpoint(&Client::new(), "secret", &source, &server.url("/shrink")).await;
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
        let error =
            compress_with_endpoint(&Client::new(), "secret", &source, &server.url("/shrink"))
                .await
                .unwrap_err();
        assert!(matches!(error, TinifyError::CapacityExhausted(500)));
    }

    #[tokio::test]
    async fn new_folder_output_never_overwrites_existing_file() {
        let temp = tempdir().unwrap();
        let output = temp.path().join("image.png");
        fs::write(&output, b"original").unwrap();

        let error = atomic_write(&output, b"compressed".to_vec(), false)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("目标文件已存在"));
        assert_eq!(fs::read(output).unwrap(), b"original");
    }

    #[tokio::test]
    async fn overwrite_output_replaces_original_atomically() {
        let temp = tempdir().unwrap();
        let output = temp.path().join("image.png");
        fs::write(&output, b"original").unwrap();

        atomic_write(&output, b"compressed".to_vec(), true)
            .await
            .unwrap();
        assert_eq!(fs::read(output).unwrap(), b"compressed");
    }
}

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use futures::{stream, StreamExt};
use reqwest::Client;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::{
    license_api::LicenseApi,
    models::{
        CompressionFinished, CompressionProgress, CompressionStart, CompressionSummary,
        ImageJobView, KeyState, LicenseView,
    },
    scanner::ImageJob,
    tinify::{self, TinifyError},
    vault::CredentialVault,
};

pub const COMPRESSION_CONCURRENCY: usize = 4;
const CHECKPOINT_SIZE: usize = 20;

#[derive(Clone)]
pub struct CompressionRuntime {
    pub jobs: Arc<Mutex<HashMap<String, ImageJob>>>,
    pub pending_thumbnails: Arc<Mutex<HashSet<String>>>,
    pub license_api: LicenseApi,
    pub http: Client,
    pub cancel: Arc<AtomicBool>,
    pub running: Arc<AtomicBool>,
}

impl CompressionRuntime {
    pub fn new(vault: Arc<CredentialVault>) -> Result<Self> {
        let http = Client::builder()
            .user_agent(concat!("SmartImageCompressor/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(std::time::Duration::from_secs(12))
            .timeout(std::time::Duration::from_secs(90))
            .pool_max_idle_per_host(COMPRESSION_CONCURRENCY * 2)
            .tcp_nodelay(true)
            .build()
            .context("无法创建网络客户端")?;
        Ok(Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            pending_thumbnails: Arc::new(Mutex::new(HashSet::new())),
            license_api: LicenseApi::new(http.clone(), vault),
            http,
            cancel: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn insert_jobs(&self, jobs: Vec<ImageJob>) -> Result<Vec<ImageJobView>> {
        let views = jobs.iter().map(ImageJob::view).collect::<Vec<_>>();
        let mut stored = self
            .jobs
            .lock()
            .map_err(|_| anyhow::anyhow!("任务队列锁已损坏"))?;
        for job in jobs {
            stored.insert(job.id.clone(), job);
        }
        Ok(views)
    }

    pub fn job_sources(&self, ids: Vec<String>) -> Result<Vec<(String, PathBuf)>> {
        let stored = self
            .jobs
            .lock()
            .map_err(|_| anyhow::anyhow!("任务队列锁已损坏"))?;
        Ok(ids
            .into_iter()
            .filter_map(|id| stored.get(&id).map(|job| (id, job.source.clone())))
            .collect())
    }

    pub fn remove_jobs(&self, ids: &[String]) -> Result<()> {
        let mut stored = self
            .jobs
            .lock()
            .map_err(|_| anyhow::anyhow!("任务队列锁已损坏"))?;
        for id in ids {
            stored.remove(id);
        }
        Ok(())
    }
}

fn emit_progress(app: &AppHandle, progress: CompressionProgress) {
    let _ = app.emit("compression-progress", progress);
}

#[derive(Debug)]
struct FileOutcome {
    id: String,
    status: &'static str,
    compressed_size: Option<u64>,
    savings_percent: Option<f64>,
    error: Option<String>,
    observed_at: Option<DateTime<Utc>>,
}

impl FileOutcome {
    fn progress(&self) -> CompressionProgress {
        CompressionProgress {
            id: self.id.clone(),
            status: self.status.into(),
            stage: None,
            compressed_size: self.compressed_size,
            savings_percent: self.savings_percent,
            error: self.error.clone(),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum OutputMode {
    NewFolder,
    Overwrite,
}

impl OutputMode {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "new_folder" => Ok(Self::NewFolder),
            "overwrite" => Ok(Self::Overwrite),
            _ => anyhow::bail!("输出方式无效"),
        }
    }
}

fn reset_month(keys: &mut [KeyState]) {
    let month = Utc::now().format("%Y-%m").to_string();
    for key in keys {
        if key.month != month {
            key.month = month.clone();
            key.count = 0;
        }
    }
}

async fn claim_key(keys: &AsyncMutex<Vec<KeyState>>) -> Option<(usize, String)> {
    let mut keys = keys.lock().await;
    reset_month(&mut keys);
    let index = keys
        .iter()
        .enumerate()
        .filter(|(_, key)| !key.invalid && key.count < 500)
        .min_by_key(|(_, key)| key.count)
        .map(|(index, _)| index)?;
    keys[index].count += 1;
    Some((index, keys[index].api_key.clone()))
}

async fn update_key_after_result(
    keys: &AsyncMutex<Vec<KeyState>>,
    index: usize,
    count: Option<u32>,
    invalid: bool,
    failed: bool,
) {
    let mut keys = keys.lock().await;
    if let Some(key) = keys.get_mut(index) {
        if invalid {
            key.invalid = true;
        }
        if let Some(count) = count {
            key.count = count;
        } else if failed {
            key.count = key.count.saturating_sub(1);
        }
    }
}

async fn process_job(
    runtime: &CompressionRuntime,
    app: &AppHandle,
    job: ImageJob,
    keys: Arc<AsyncMutex<Vec<KeyState>>>,
    output_mode: OutputMode,
    expires_at: DateTime<Utc>,
) -> FileOutcome {
    if runtime.cancel.load(Ordering::SeqCst) {
        return FileOutcome {
            id: job.id,
            status: "cancelled",
            compressed_size: None,
            savings_percent: None,
            error: Some("任务已取消".into()),
            observed_at: None,
        };
    }
    if Utc::now() >= expires_at {
        return FileOutcome {
            id: job.id,
            status: "failed",
            compressed_size: None,
            savings_percent: None,
            error: Some("授权已到期".into()),
            observed_at: None,
        };
    }
    let output_path = if output_mode == OutputMode::Overwrite {
        &job.source
    } else {
        &job.output
    };
    if output_mode == OutputMode::NewFolder
        && tokio::fs::try_exists(output_path).await.unwrap_or(false)
    {
        return FileOutcome {
            id: job.id,
            status: "skipped",
            compressed_size: None,
            savings_percent: None,
            error: Some("目标已存在，未覆盖".into()),
            observed_at: None,
        };
    }

    emit_progress(
        app,
        CompressionProgress {
            id: job.id.clone(),
            status: "compressing".into(),
            stage: Some("preparing".into()),
            compressed_size: None,
            savings_percent: None,
            error: None,
        },
    );

    loop {
        let Some((key_index, api_key)) = claim_key(&keys).await else {
            return FileOutcome {
                id: job.id,
                status: "failed",
                compressed_size: None,
                savings_percent: None,
                error: Some("已领取的 TinyPNG Token 本月容量均已用尽".into()),
                observed_at: None,
            };
        };
        let progress_id = job.id.clone();
        match tinify::compress_to_file(
            &runtime.http,
            &api_key,
            &job.source,
            output_path,
            output_mode == OutputMode::Overwrite,
            expires_at,
            |stage| {
                emit_progress(
                    app,
                    CompressionProgress {
                        id: progress_id.clone(),
                        status: "compressing".into(),
                        stage: Some(stage.into()),
                        compressed_size: None,
                        savings_percent: None,
                        error: None,
                    },
                );
            },
        )
        .await
        {
            Ok(output) => {
                update_key_after_result(&keys, key_index, output.compression_count, false, false)
                    .await;
                let savings = if job.original_size == 0 {
                    0.0
                } else {
                    (1.0 - output.compressed_size as f64 / job.original_size as f64) * 100.0
                };
                return FileOutcome {
                    id: job.id,
                    status: "completed",
                    compressed_size: Some(output.compressed_size),
                    savings_percent: Some(savings.max(0.0)),
                    error: None,
                    observed_at: output.server_time,
                };
            }
            Err(TinifyError::CapacityExhausted(count)) => {
                update_key_after_result(&keys, key_index, Some(count), false, false).await;
            }
            Err(TinifyError::InvalidKey) => {
                update_key_after_result(&keys, key_index, None, true, false).await;
            }
            Err(error) => {
                update_key_after_result(&keys, key_index, None, false, true).await;
                let message = error.to_string();
                let status = if message.contains("目标文件已存在") {
                    "skipped"
                } else {
                    "failed"
                };
                return FileOutcome {
                    id: job.id,
                    status,
                    compressed_size: None,
                    savings_percent: None,
                    error: Some(message),
                    observed_at: None,
                };
            }
        }
    }
}

struct RunningGuard(Arc<AtomicBool>);

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn mark_unprocessed(
    app: &AppHandle,
    jobs: &[ImageJob],
    processed: &mut HashSet<String>,
    status: &'static str,
    error: &str,
) -> usize {
    let mut count = 0;
    for job in jobs {
        if processed.insert(job.id.clone()) {
            count += 1;
            emit_progress(
                app,
                CompressionProgress {
                    id: job.id.clone(),
                    status: status.into(),
                    stage: None,
                    compressed_size: None,
                    savings_percent: None,
                    error: Some(error.into()),
                },
            );
        }
    }
    count
}

async fn run_compression(
    runtime: CompressionRuntime,
    app: AppHandle,
    jobs: Vec<ImageJob>,
    output_mode: OutputMode,
    mut latest_license: LicenseView,
) -> Result<CompressionSummary> {
    let _running_guard = RunningGuard(runtime.running.clone());
    let keys = Arc::new(AsyncMutex::new(runtime.license_api.key_states()?));
    let mut completed = 0;
    let mut failed = 0;
    let mut skipped = 0;
    let mut cancelled = 0;
    let mut processed = HashSet::new();
    let execution_report_id = Uuid::new_v4().to_string();

    let license_api = runtime.license_api.clone();
    tauri::async_runtime::spawn(async move {
        let _ = license_api.sync_pending_usage_reports().await;
    });

    for chunk in jobs.chunks(CHECKPOINT_SIZE) {
        if runtime.cancel.load(Ordering::SeqCst) {
            break;
        }
        let has_capacity = {
            let mut locked = keys.lock().await;
            reset_month(&mut locked);
            locked.iter().any(|key| !key.invalid && key.count < 500)
        };
        if !has_capacity {
            failed += mark_unprocessed(
                &app,
                &jobs,
                &mut processed,
                "failed",
                "已领取的 TinyPNG Token 本月容量均已用尽",
            );
            break;
        }

        let (reservation_id, reserved_license) = runtime
            .license_api
            .reserve_local(chunk.len(), &execution_report_id)?;
        let expires_at = reserved_license
            .expires_at
            .as_deref()
            .context("授权有效期缺失")
            .and_then(|value| {
                DateTime::parse_from_rfc3339(value)
                    .map(|value| value.with_timezone(&Utc))
                    .context("授权有效期格式无效")
            })?;
        let batch_jobs = chunk.to_vec();
        let mut outcomes = stream::iter(batch_jobs.into_iter().map(|job| {
            let runtime = runtime.clone();
            let app = app.clone();
            let keys = keys.clone();
            async move { process_job(&runtime, &app, job, keys, output_mode, expires_at).await }
        }))
        .buffer_unordered(COMPRESSION_CONCURRENCY);

        let mut success_count = 0_u32;
        let mut observed_at: Option<DateTime<Utc>> = None;
        while let Some(outcome) = outcomes.next().await {
            if let Some(value) = outcome.observed_at {
                observed_at = Some(observed_at.map_or(value, |current| current.max(value)));
            }
            processed.insert(outcome.id.clone());
            match outcome.status {
                "completed" => {
                    completed += 1;
                    success_count += 1;
                }
                "failed" => failed += 1,
                "skipped" => skipped += 1,
                "cancelled" => cancelled += 1,
                _ => {}
            }
            emit_progress(&app, outcome.progress());
        }
        latest_license = runtime.license_api.complete_local(
            &reservation_id,
            success_count,
            keys.lock().await.clone(),
            observed_at,
        )?;
    }

    if runtime.cancel.load(Ordering::SeqCst) {
        cancelled += mark_unprocessed(&app, &jobs, &mut processed, "cancelled", "任务已取消");
    }

    let _ = runtime.license_api.sync_pending_usage_reports().await;
    Ok(CompressionSummary {
        completed,
        failed,
        skipped,
        cancelled,
        license: latest_license,
        pending_usage_reports: runtime.license_api.pending_usage_report_count()?,
    })
}

pub async fn start(
    runtime: CompressionRuntime,
    ids: Vec<String>,
    output_mode: &str,
    app: AppHandle,
) -> Result<CompressionStart> {
    if ids.is_empty() {
        anyhow::bail!("任务队列为空");
    }
    let output_mode = OutputMode::parse(output_mode)?;
    let current_license = runtime.license_api.refresh()?;
    if current_license.status != "active" {
        anyhow::bail!("授权已到期、用尽或系统时间无效");
    }
    let jobs = {
        let stored = runtime
            .jobs
            .lock()
            .map_err(|_| anyhow::anyhow!("任务队列锁已损坏"))?;
        ids.iter()
            .filter_map(|id| stored.get(id).cloned())
            .collect::<Vec<_>>()
    };
    if jobs.len() != ids.len() {
        anyhow::bail!("部分任务已失效，请重新添加");
    }
    let remaining = current_license.limit.saturating_sub(current_license.used);
    if jobs.len() as u32 > remaining {
        anyhow::bail!("本地授权仅剩 {remaining} 张额度，请减少本批图片数量");
    }
    if runtime.running.swap(true, Ordering::SeqCst) {
        anyhow::bail!("已有任务正在执行");
    }
    runtime.cancel.store(false, Ordering::SeqCst);
    let runner = runtime.clone();
    tauri::async_runtime::spawn(async move {
        let finished =
            match run_compression(runner, app.clone(), jobs, output_mode, current_license).await {
                Ok(summary) => CompressionFinished {
                    summary: Some(summary),
                    error: None,
                },
                Err(error) => CompressionFinished {
                    summary: None,
                    error: Some(error.to_string()),
                },
            };
        let _ = app.emit("compression-finished", finished);
    });
    Ok(CompressionStart {
        accepted_count: ids.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn claims_the_least_used_key_and_stops_at_monthly_limit() {
        let keys = AsyncMutex::new(vec![
            KeyState {
                api_key: "a".into(),
                month: Utc::now().format("%Y-%m").to_string(),
                count: 499,
                invalid: false,
            },
            KeyState {
                api_key: "b".into(),
                month: Utc::now().format("%Y-%m").to_string(),
                count: 10,
                invalid: false,
            },
        ]);
        let (index, key) = claim_key(&keys).await.unwrap();
        assert_eq!(index, 1);
        assert_eq!(key, "b");
        update_key_after_result(&keys, 1, Some(500), false, false).await;
        let (_, key) = claim_key(&keys).await.unwrap();
        assert_eq!(key, "a");
    }
}

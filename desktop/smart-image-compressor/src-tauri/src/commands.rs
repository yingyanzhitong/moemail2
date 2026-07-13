use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
};

use anyhow::{Context, Result};
use chrono::Utc;
use futures::{stream, StreamExt};
use reqwest::Client;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex as AsyncMutex;

use crate::{
    license_api::LicenseApi,
    models::{
        BootstrapView, CompressionProgress, CompressionSummary, ImageJobView, KeyState, LicenseView,
    },
    scanner::{scan_paths, ImageJob},
    tinify::{self, TinifyError},
    vault::CredentialVault,
};

pub struct AppState {
    pub jobs: Mutex<HashMap<String, ImageJob>>,
    pub pending_activation: Mutex<Option<String>>,
    pub license_api: LicenseApi,
    pub http: Client,
    pub cancel: AtomicBool,
    pub running: AtomicBool,
}

impl AppState {
    pub fn new(vault: Arc<CredentialVault>) -> Result<Self> {
        let http = Client::builder()
            .user_agent(concat!("SmartImageCompressor/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(90))
            .build()
            .context("无法创建网络客户端")?;
        Ok(Self {
            jobs: Mutex::new(HashMap::new()),
            pending_activation: Mutex::new(None),
            license_api: LicenseApi::new(http.clone(), vault.clone()),
            http,
            cancel: AtomicBool::new(false),
            running: AtomicBool::new(false),
        })
    }
}

fn command_error(error: impl std::fmt::Display) -> String {
    serde_json::json!({ "message": error.to_string() }).to_string()
}

#[tauri::command]
pub fn take_activation_code(
    state: State<'_, AppState>,
) -> std::result::Result<Option<String>, String> {
    state
        .pending_activation
        .lock()
        .map(|mut pending| pending.take())
        .map_err(|_| command_error("激活链接状态锁已损坏"))
}

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> std::result::Result<BootstrapView, String> {
    state.license_api.bootstrap().await.map_err(command_error)
}

#[tauri::command]
pub async fn redeem_activation(
    code: String,
    state: State<'_, AppState>,
) -> std::result::Result<LicenseView, String> {
    let code = code.trim();
    if code.len() < 20 || code.len() > 256 {
        return Err(command_error("授权码格式无效"));
    }
    state.license_api.redeem(code).await.map_err(command_error)
}

#[tauri::command]
pub async fn refresh_license(
    state: State<'_, AppState>,
) -> std::result::Result<LicenseView, String> {
    state.license_api.refresh().await.map_err(command_error)
}

fn store_jobs(
    state: &AppState,
    jobs: Vec<ImageJob>,
) -> std::result::Result<Vec<ImageJobView>, String> {
    let views = jobs.iter().map(ImageJob::view).collect();
    let mut stored = state
        .jobs
        .lock()
        .map_err(|_| command_error("任务队列锁已损坏"))?;
    for job in jobs {
        stored.insert(job.id.clone(), job);
    }
    Ok(views)
}

async fn scan_and_store(
    state: &AppState,
    paths: Vec<PathBuf>,
) -> std::result::Result<Vec<ImageJobView>, String> {
    let jobs = tokio::task::spawn_blocking(move || scan_paths(paths))
        .await
        .map_err(command_error)?
        .map_err(command_error)?;
    store_jobs(state, jobs)
}

#[tauri::command]
pub async fn pick_images(
    app: AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<Vec<ImageJobView>, String> {
    let selected = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("支持的图片", &["avif", "webp", "jpg", "jpeg", "png"])
            .blocking_pick_files()
    })
    .await
    .map_err(command_error)?;
    let paths = selected
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .collect();
    scan_and_store(&state, paths).await
}

#[tauri::command]
pub async fn pick_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<Vec<ImageJobView>, String> {
    let selected = tokio::task::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
        .await
        .map_err(command_error)?;
    let paths = selected
        .and_then(|path| path.into_path().ok())
        .into_iter()
        .collect();
    scan_and_store(&state, paths).await
}

#[tauri::command]
pub async fn add_paths(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> std::result::Result<Vec<ImageJobView>, String> {
    scan_and_store(&state, paths.into_iter().map(PathBuf::from).collect()).await
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
}

impl FileOutcome {
    fn progress(&self) -> CompressionProgress {
        CompressionProgress {
            id: self.id.clone(),
            status: self.status.into(),
            compressed_size: self.compressed_size,
            savings_percent: self.savings_percent,
            error: self.error.clone(),
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
    state: &AppState,
    app: &AppHandle,
    job: ImageJob,
    keys: Arc<AsyncMutex<Vec<KeyState>>>,
    top_up_lock: Arc<AsyncMutex<()>>,
    reservation_id: String,
    durable_success_count: Arc<AtomicU32>,
) -> FileOutcome {
    if state.cancel.load(Ordering::SeqCst) {
        return FileOutcome {
            id: job.id,
            status: "cancelled",
            compressed_size: None,
            savings_percent: None,
            error: Some("任务已取消".into()),
        };
    }
    if tokio::fs::try_exists(&job.output).await.unwrap_or(false) {
        return FileOutcome {
            id: job.id,
            status: "skipped",
            compressed_size: None,
            savings_percent: None,
            error: Some("目标已存在，未覆盖".into()),
        };
    }
    emit_progress(
        app,
        CompressionProgress {
            id: job.id.clone(),
            status: "compressing".into(),
            compressed_size: None,
            savings_percent: None,
            error: None,
        },
    );

    for _ in 0..80 {
        let claimed = claim_key(&keys).await;
        let (key_index, api_key) = if let Some(claimed) = claimed {
            claimed
        } else {
            let _top_up_guard = top_up_lock.lock().await;
            if let Some(claimed) = claim_key(&keys).await {
                claimed
            } else {
                match state.license_api.top_up().await {
                    Ok(additional) if !additional.is_empty() => {
                        keys.lock().await.extend(additional);
                        let Some(claimed) = claim_key(&keys).await else {
                            return FileOutcome {
                                id: job.id,
                                status: "failed",
                                compressed_size: None,
                                savings_percent: None,
                                error: Some("服务容量暂时不足，请稍后重试".into()),
                            };
                        };
                        claimed
                    }
                    Ok(_) => {
                        return FileOutcome {
                            id: job.id,
                            status: "failed",
                            compressed_size: None,
                            savings_percent: None,
                            error: Some("服务容量暂时不足，请稍后重试".into()),
                        }
                    }
                    Err(error) => {
                        return FileOutcome {
                            id: job.id,
                            status: "failed",
                            compressed_size: None,
                            savings_percent: None,
                            error: Some(error.to_string()),
                        }
                    }
                }
            }
        };
        match tinify::compress(&state.http, &api_key, &job.source).await {
            Ok(output) => {
                update_key_after_result(&keys, key_index, output.compression_count, false, false)
                    .await;
                if let Err(error) = tinify::atomic_write(&job.output, &output.bytes).await {
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
                    };
                }
                let compressed_size = output.bytes.len() as u64;
                let savings = if job.original_size == 0 {
                    0.0
                } else {
                    (1.0 - compressed_size as f64 / job.original_size as f64) * 100.0
                };
                let success_count = durable_success_count.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = state
                    .license_api
                    .record_success(&reservation_id, success_count);
                return FileOutcome {
                    id: job.id,
                    status: "completed",
                    compressed_size: Some(compressed_size),
                    savings_percent: Some(savings.max(0.0)),
                    error: None,
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
                return FileOutcome {
                    id: job.id,
                    status: "failed",
                    compressed_size: None,
                    savings_percent: None,
                    error: Some(error.to_string()),
                };
            }
        }
    }
    FileOutcome {
        id: job.id,
        status: "failed",
        compressed_size: None,
        savings_percent: None,
        error: Some("没有可用的 TinyPNG Key".into()),
    }
}

struct RunningGuard<'a>(&'a AtomicBool);
impl Drop for RunningGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn start_compression(
    ids: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<CompressionSummary, String> {
    if ids.is_empty() {
        return Err(command_error("任务队列为空"));
    }
    if state.running.swap(true, Ordering::SeqCst) {
        return Err(command_error("已有任务正在执行"));
    }
    let _guard = RunningGuard(&state.running);
    state.cancel.store(false, Ordering::SeqCst);

    state
        .license_api
        .reconcile_pending()
        .await
        .map_err(command_error)?;
    let current_license = state.license_api.refresh().await.map_err(command_error)?;
    if current_license.status != "active" {
        return Err(command_error("授权已到期、用尽或被撤销"));
    }

    let jobs = {
        let stored = state
            .jobs
            .lock()
            .map_err(|_| command_error("任务队列锁已损坏"))?;
        ids.iter()
            .filter_map(|id| stored.get(id).cloned())
            .collect::<Vec<_>>()
    };
    if jobs.len() != ids.len() {
        return Err(command_error("部分任务已失效，请重新添加"));
    }

    let keys = Arc::new(AsyncMutex::new(
        state.license_api.key_states().map_err(command_error)?,
    ));
    let mut completed = 0;
    let mut failed = 0;
    let mut skipped = 0;
    let mut cancelled = 0;
    let mut latest_license = current_license;
    let mut processed = HashSet::new();

    for chunk in jobs.chunks(20) {
        if state.cancel.load(Ordering::SeqCst) {
            break;
        }

        let has_capacity = {
            let mut locked = keys.lock().await;
            reset_month(&mut locked);
            locked.iter().any(|key| !key.invalid && key.count < 500)
        };
        if !has_capacity {
            let additional = state.license_api.top_up().await.map_err(command_error)?;
            if additional.is_empty() {
                return Err(command_error("服务容量暂时不足，请稍后重试"));
            }
            keys.lock().await.extend(additional);
        }

        let reservation_id = state
            .license_api
            .reserve(chunk.len())
            .await
            .map_err(command_error)?;
        let top_up_lock = Arc::new(AsyncMutex::new(()));
        let durable_success_count = Arc::new(AtomicU32::new(0));
        let batch_jobs = chunk.to_vec();
        let outcomes = stream::iter(batch_jobs.into_iter().map(|job| {
            let keys = keys.clone();
            let top_up_lock = top_up_lock.clone();
            let reservation_id = reservation_id.clone();
            let durable_success_count = durable_success_count.clone();
            async {
                process_job(
                    &state,
                    &app,
                    job,
                    keys,
                    top_up_lock,
                    reservation_id,
                    durable_success_count,
                )
                .await
            }
        }))
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;

        let mut success_count = 0_u32;
        for outcome in outcomes {
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
        state
            .license_api
            .record_success(&reservation_id, success_count)
            .map_err(command_error)?;
        state
            .license_api
            .save_key_states(keys.lock().await.clone())
            .map_err(command_error)?;
        latest_license = state
            .license_api
            .complete(&reservation_id, success_count)
            .await
            .map_err(command_error)?;
    }

    if state.cancel.load(Ordering::SeqCst) {
        for job in jobs.iter().filter(|job| !processed.contains(&job.id)) {
            cancelled += 1;
            emit_progress(
                &app,
                CompressionProgress {
                    id: job.id.clone(),
                    status: "cancelled".into(),
                    compressed_size: None,
                    savings_percent: None,
                    error: Some("任务已取消".into()),
                },
            );
        }
    }

    Ok(CompressionSummary {
        completed,
        failed,
        skipped,
        cancelled,
        license: latest_license,
    })
}

#[tauri::command]
pub fn cancel_compression(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

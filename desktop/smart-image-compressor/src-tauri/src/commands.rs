use std::{
    path::PathBuf,
    process::Command,
    sync::{Arc, Mutex},
};

use anyhow::Result;
use futures::{stream, StreamExt};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

use crate::{
    compression::{self, CompressionRuntime},
    models::{
        ActivationPlanPreview, BootstrapView, CompressionStart, LicenseView, ScanComplete,
        ThumbnailReady,
    },
    scanner::{generate_thumbnail, scan_paths_in_batches},
    vault::CredentialVault,
};

#[cfg(debug_assertions)]
use crate::models::TokenUsageReport;

pub struct AppState {
    pub runtime: CompressionRuntime,
    pub pending_activation: Mutex<Option<String>>,
}

impl AppState {
    pub fn new(vault: Arc<CredentialVault>) -> Result<Self> {
        Ok(Self {
            runtime: CompressionRuntime::new(vault)?,
            pending_activation: Mutex::new(None),
        })
    }
}

fn command_error(error: impl std::fmt::Display) -> String {
    serde_json::json!({ "message": error.to_string() }).to_string()
}

fn begin_import(app: AppHandle, runtime: CompressionRuntime, paths: Vec<PathBuf>) {
    tauri::async_runtime::spawn_blocking(move || {
        let event_app = app.clone();
        let report = scan_paths_in_batches(paths, |batch| {
            let views = match runtime.insert_jobs(batch) {
                Ok(views) => views,
                Err(_) => return,
            };
            let _ = event_app.emit("queue-items-added", views);
        });
        let _ = app.emit(
            "scan-complete",
            ScanComplete {
                discovered: report.discovered,
                skipped: report.skipped,
            },
        );
    });
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
    state
        .runtime
        .license_api
        .bootstrap()
        .await
        .map_err(command_error)
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
    state
        .runtime
        .license_api
        .redeem(code)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn preview_activation(
    code: String,
    state: State<'_, AppState>,
) -> std::result::Result<ActivationPlanPreview, String> {
    let code = code.trim();
    if code.len() < 20 || code.len() > 256 {
        return Err(command_error("授权码格式无效"));
    }
    state
        .runtime
        .license_api
        .preview(code)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn refresh_license(
    state: State<'_, AppState>,
) -> std::result::Result<LicenseView, String> {
    state
        .runtime
        .license_api
        .refresh_online()
        .await
        .map_err(command_error)
}

#[tauri::command]
pub fn delete_license_package(
    license_id: String,
    state: State<'_, AppState>,
) -> std::result::Result<LicenseView, String> {
    state
        .runtime
        .license_api
        .delete_revoked_package(&license_id)
        .map_err(command_error)
}

#[cfg(debug_assertions)]
#[tauri::command]
pub async fn query_token_usage(
    package_id: Option<String>,
    state: State<'_, AppState>,
) -> std::result::Result<TokenUsageReport, String> {
    state
        .runtime
        .token_usage(package_id)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub async fn pick_images(
    app: AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let dialog_app = app.clone();
    let selected = tokio::task::spawn_blocking(move || {
        dialog_app
            .dialog()
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
        .collect::<Vec<_>>();
    if !paths.is_empty() {
        begin_import(app, state.runtime.clone(), paths);
    } else {
        let _ = app.emit(
            "scan-complete",
            ScanComplete {
                discovered: 0,
                skipped: 0,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn pick_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let dialog_app = app.clone();
    let selected =
        tokio::task::spawn_blocking(move || dialog_app.dialog().file().blocking_pick_folder())
            .await
            .map_err(command_error)?;
    let paths = selected
        .and_then(|path| path.into_path().ok())
        .into_iter()
        .collect::<Vec<_>>();
    if !paths.is_empty() {
        state.runtime.clear_jobs().map_err(command_error)?;
        let _ = app.emit("queue-replaced", ());
        begin_import(app, state.runtime.clone(), paths);
    } else {
        let _ = app.emit(
            "scan-complete",
            ScanComplete {
                discovered: 0,
                skipped: 0,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub fn add_paths(
    paths: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    if !paths.is_empty() {
        begin_import(
            app,
            state.runtime.clone(),
            paths.into_iter().map(PathBuf::from).collect(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn request_thumbnails(
    ids: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let candidates = {
        let sources = state.runtime.job_sources(ids).map_err(command_error)?;
        let mut pending = state
            .runtime
            .pending_thumbnails
            .lock()
            .map_err(|_| command_error("缩略图队列锁已损坏"))?;
        sources
            .into_iter()
            .filter(|(id, _)| pending.insert(id.clone()))
            .collect::<Vec<_>>()
    };
    if candidates.is_empty() {
        return Ok(());
    }
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn(async move {
        stream::iter(candidates.into_iter().map(|(id, path)| {
            let app = app.clone();
            let runtime = runtime.clone();
            async move {
                if runtime.running.load(std::sync::atomic::Ordering::SeqCst) {
                    if let Ok(mut pending) = runtime.pending_thumbnails.lock() {
                        pending.remove(&id);
                    }
                    return;
                }
                let thumbnail = tokio::task::spawn_blocking(move || generate_thumbnail(&path))
                    .await
                    .ok()
                    .flatten();
                if let Some(thumbnail_data_url) = thumbnail {
                    let _ = app.emit(
                        "thumbnail-ready",
                        ThumbnailReady {
                            id: id.clone(),
                            thumbnail_data_url,
                        },
                    );
                }
                if let Ok(mut pending) = runtime.pending_thumbnails.lock() {
                    pending.remove(&id);
                }
            }
        }))
        .buffer_unordered(2)
        .collect::<Vec<_>>()
        .await;
    });
    Ok(())
}

#[tauri::command]
pub fn remove_jobs(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    state.runtime.remove_jobs(&ids).map_err(command_error)
}

#[tauri::command]
pub fn open_result_folders(
    ids: Vec<String>,
    state: State<'_, AppState>,
) -> std::result::Result<(), String> {
    let folders = state.runtime.result_folders(&ids).map_err(command_error)?;
    for folder in folders {
        #[cfg(target_os = "macos")]
        Command::new("open")
            .arg(&folder)
            .spawn()
            .map_err(|error| command_error(format!("无法打开结果文件夹：{error}")))?;
        #[cfg(target_os = "windows")]
        Command::new("explorer.exe")
            .arg(&folder)
            .spawn()
            .map_err(|error| command_error(format!("无法打开结果文件夹：{error}")))?;
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = folder;
            return Err(command_error("当前系统不支持打开结果文件夹"));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn start_compression(
    ids: Vec<String>,
    output_mode: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> std::result::Result<CompressionStart, String> {
    compression::start(state.runtime.clone(), ids, &output_mode, app)
        .await
        .map_err(command_error)
}

#[tauri::command]
pub fn cancel_compression(state: State<'_, AppState>) {
    state
        .runtime
        .cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);
}

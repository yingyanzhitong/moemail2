mod commands;
mod license_api;
mod models;
mod scanner;
mod tinify;
mod vault;

use std::sync::Arc;

use commands::AppState;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;
use vault::CredentialVault;

fn activation_code(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    if url.scheme() != "smartcompress" {
        return None;
    }
    url.query_pairs()
        .find_map(|(key, value)| (key == "code").then(|| value.into_owned()))
}

fn emit_activation(app: &tauri::AppHandle, value: &str) {
    let Some(code) = activation_code(value) else {
        return;
    };
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut pending) = state.pending_activation.lock() {
            *pending = Some(code.clone());
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("activation-code", code);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for argument in argv {
                emit_activation(app, &argument);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let vault = Arc::new(CredentialVault::open(app.handle())?);
            vault.ensure_device_identity()?;
            app.manage(AppState::new(vault)?);

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    emit_activation(&handle, url.as_str());
                }
            });
            if let Some(urls) = app.deep_link().get_current()? {
                for url in urls {
                    emit_activation(app.handle(), url.as_str());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::take_activation_code,
            commands::bootstrap,
            commands::preview_activation,
            commands::redeem_activation,
            commands::refresh_license,
            commands::pick_images,
            commands::pick_folder,
            commands::add_paths,
            commands::load_thumbnails,
            commands::start_compression,
            commands::cancel_compression,
        ])
        .run(tauri::generate_context!())
        .expect("启动智能压缩工具失败");
}

#[cfg(test)]
mod tests {
    use super::activation_code;

    #[test]
    fn extracts_activation_code_from_deep_link() {
        assert_eq!(
            activation_code("smartcompress://activate?code=abc_123"),
            Some("abc_123".into())
        );
        assert_eq!(activation_code("https://example.com/activate/abc"), None);
    }
}

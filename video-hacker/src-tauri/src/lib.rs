use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tokio::sync::Mutex;
use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

mod downloader;
mod extractors;

use downloader::DownloadManager;
use extractors::{extract_video_info, VideoInfo};

// Application state
pub struct AppState {
    pub download_manager: Arc<Mutex<DownloadManager>>,
}

// Shared state for HTTP server
#[derive(Clone)]
struct HttpState {
    tx: tokio::sync::mpsc::Sender<String>,
}

// HTTP request/response types
#[derive(Deserialize)]
struct DownloadRequest {
    url: String,
}

#[derive(Serialize)]
struct DownloadResponse {
    success: bool,
    message: String,
}

// Tauri Commands

#[tauri::command]
async fn get_video_info(url: String) -> Result<VideoInfo, String> {
    extract_video_info(&url).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_download(
    url: String,
    format_id: String,
    output_dir: Option<String>,
    state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    let output_dir = output_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::download_dir().unwrap_or_else(|| PathBuf::from(".")));

    let task_id = uuid::Uuid::new_v4().to_string();

    let manager = state.download_manager.clone();

    // Clone window and task_id for use in the progress callback
    let window_for_progress = window.clone();
    let task_id_for_progress = task_id.clone();

    // Clone task_id for use in completion/error handling
    let task_id_for_result = task_id.clone();

    tauri::async_runtime::spawn(async move {
        let mut manager = manager.lock().await;
        match manager
            .download(&url, &format_id, &output_dir, move |progress| {
                let _ = window_for_progress.emit("download-progress", (&task_id_for_progress, &progress));
            })
            .await
        {
            Ok(path) => {
                let _ = window.emit("download-complete", (&task_id_for_result, path.to_string_lossy().to_string()));
            }
            Err(e) => {
                let _ = window.emit("download-error", (&task_id_for_result, e.to_string()));
            }
        }
    });

    Ok(task_id)
}

#[tauri::command]
async fn get_download_dir() -> Result<String, String> {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not find download directory".to_string())
}

#[tauri::command]
async fn open_download_dir() -> Result<(), String> {
    let dir = dirs::download_dir().ok_or("Could not find download directory")?;
    opener::open(dir).map_err(|e| e.to_string())
}

// HTTP Server handlers

async fn health_check() -> impl IntoResponse {
    (StatusCode::OK, "OK")
}

async fn handle_download(
    axum::extract::State(state): axum::extract::State<HttpState>,
    Json(request): Json<DownloadRequest>,
) -> impl IntoResponse {
    // Send the URL to the main app to open the window and show the download
    match state.tx.send(request.url.clone()).await {
        Ok(_) => (
            StatusCode::OK,
            Json(DownloadResponse {
                success: true,
                message: "Download request sent to app".to_string(),
            }),
        ),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(DownloadResponse {
                success: false,
                message: "Failed to send download request".to_string(),
            }),
        ),
    }
}

// Start HTTP server for browser extension communication
async fn start_http_server(tx: tokio::sync::mpsc::Sender<String>) {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = HttpState { tx };

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/download", post(handle_download))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8765").await;

    match listener {
        Ok(listener) => {
            println!("HTTP server listening on http://127.0.0.1:8765");
            let _ = axum::serve(listener, app).await;
        }
        Err(e) => {
            eprintln!("Failed to start HTTP server: {}", e);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        download_manager: Arc::new(Mutex::new(DownloadManager::new())),
    };

    // Create channel for communication between HTTP server and app
    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_video_info,
            start_download,
            get_download_dir,
            open_download_dir,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Start HTTP server in background
            let tx_clone = tx.clone();
            tauri::async_runtime::spawn(async move {
                start_http_server(tx_clone).await;
            });

            // Handle incoming URLs from extension
            tauri::async_runtime::spawn(async move {
                while let Some(url) = rx.recv().await {
                    // Send the URL to the frontend
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("extension-download", &url);
                        // Bring window to front
                        let _ = window.set_focus();
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

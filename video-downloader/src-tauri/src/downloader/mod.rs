use crate::extractors::{extract_video_info, ExtractError, VideoFormat};
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

#[derive(Error, Debug)]
pub enum DownloadError {
    #[error("Extract error: {0}")]
    ExtractError(#[from] ExtractError),
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Format not found: {0}")]
    FormatNotFound(String),
    #[error("Download cancelled")]
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percentage: f32,
    pub speed: f64, // bytes per second
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub title: String,
    pub status: DownloadStatus,
    pub progress: DownloadProgress,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DownloadStatus {
    Pending,
    Downloading,
    Processing,
    Completed,
    Failed,
    Cancelled,
}

pub struct DownloadManager {
    client: Client,
}

impl DownloadManager {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap();

        Self { client }
    }

    pub async fn download<F>(
        &mut self,
        url: &str,
        format_id: &str,
        output_dir: &PathBuf,
        progress_callback: F,
    ) -> Result<PathBuf, DownloadError>
    where
        F: Fn(DownloadProgress) + Send + 'static,
    {
        // Get video info
        let video_info = extract_video_info(url).await?;

        // Find the requested format
        let format = video_info
            .formats
            .iter()
            .find(|f| f.format_id == format_id)
            .or_else(|| video_info.formats.first())
            .ok_or_else(|| DownloadError::FormatNotFound(format_id.to_string()))?;

        // Sanitize filename
        let safe_title = sanitize_filename(&video_info.title);
        let filename = format!("{}.{}", safe_title, format.ext);
        let output_path = output_dir.join(&filename);

        // Download the file
        self.download_file(&format.url, &output_path, progress_callback)
            .await?;

        Ok(output_path)
    }

    async fn download_file<F>(
        &self,
        url: &str,
        output_path: &PathBuf,
        progress_callback: F,
    ) -> Result<(), DownloadError>
    where
        F: Fn(DownloadProgress) + Send + 'static,
    {
        let response = self.client.get(url).send().await?;

        let total_size = response.content_length();

        let mut file = File::create(output_path).await?;
        let mut downloaded: u64 = 0;
        let mut stream = response.bytes_stream();

        let start_time = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                downloaded as f64 / elapsed
            } else {
                0.0
            };

            let percentage = total_size
                .map(|total| (downloaded as f32 / total as f32) * 100.0)
                .unwrap_or(0.0);

            progress_callback(DownloadProgress {
                downloaded,
                total: total_size,
                percentage,
                speed,
            });
        }

        file.flush().await?;

        Ok(())
    }
}

fn sanitize_filename(name: &str) -> String {
    let invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

    let sanitized: String = name
        .chars()
        .map(|c| {
            if invalid_chars.contains(&c) {
                '_'
            } else {
                c
            }
        })
        .collect();

    // Truncate to reasonable length
    if sanitized.len() > 200 {
        sanitized[..200].to_string()
    } else {
        sanitized
    }
}

impl Default for DownloadManager {
    fn default() -> Self {
        Self::new()
    }
}

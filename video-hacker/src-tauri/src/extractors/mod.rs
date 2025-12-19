mod youtube;
mod twitter;
mod generic;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ExtractError {
    #[error("Unsupported URL: {0}")]
    UnsupportedUrl(String),
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
    #[error("Parse error: {0}")]
    ParseError(String),
    #[error("Video not found")]
    VideoNotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub duration: Option<u64>,
    pub uploader: Option<String>,
    pub formats: Vec<VideoFormat>,
    pub site: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoFormat {
    pub format_id: String,
    pub ext: String,
    pub quality: String,
    pub url: String,
    pub filesize: Option<u64>,
    pub has_video: bool,
    pub has_audio: bool,
}

pub async fn extract_video_info(url: &str) -> Result<VideoInfo, ExtractError> {
    // Try each extractor in order
    if youtube::is_youtube_url(url) {
        return youtube::extract(url).await;
    }

    if twitter::is_twitter_url(url) {
        return twitter::extract(url).await;
    }

    // Fallback to generic extractor
    generic::extract(url).await
}

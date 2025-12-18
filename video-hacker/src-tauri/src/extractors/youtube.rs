use super::{ExtractError, VideoFormat, VideoInfo};
use regex::Regex;
use reqwest::Client;
use serde_json::Value;

pub fn is_youtube_url(url: &str) -> bool {
    let patterns = [
        r"(?:https?://)?(?:www\.)?youtube\.com/watch\?v=",
        r"(?:https?://)?(?:www\.)?youtube\.com/shorts/",
        r"(?:https?://)?youtu\.be/",
    ];

    patterns.iter().any(|p| {
        Regex::new(p)
            .map(|re| re.is_match(url))
            .unwrap_or(false)
    })
}

fn extract_video_id(url: &str) -> Option<String> {
    // youtube.com/watch?v=ID
    if let Some(caps) = Regex::new(r"[?&]v=([a-zA-Z0-9_-]{11})").ok()?.captures(url) {
        return caps.get(1).map(|m| m.as_str().to_string());
    }

    // youtu.be/ID
    if let Some(caps) = Regex::new(r"youtu\.be/([a-zA-Z0-9_-]{11})").ok()?.captures(url) {
        return caps.get(1).map(|m| m.as_str().to_string());
    }

    // youtube.com/shorts/ID
    if let Some(caps) = Regex::new(r"shorts/([a-zA-Z0-9_-]{11})").ok()?.captures(url) {
        return caps.get(1).map(|m| m.as_str().to_string());
    }

    None
}

pub async fn extract(url: &str) -> Result<VideoInfo, ExtractError> {
    let video_id = extract_video_id(url)
        .ok_or_else(|| ExtractError::ParseError("Could not extract video ID".into()))?;

    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()?;

    // Use the innertube API (Android client for better format availability)
    let api_url = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

    let payload = serde_json::json!({
        "videoId": video_id,
        "context": {
            "client": {
                "clientName": "ANDROID",
                "clientVersion": "19.09.37",
                "androidSdkVersion": 30,
                "hl": "en",
                "gl": "US"
            }
        }
    });

    let response = client
        .post(api_url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await?;

    let json: Value = response.json().await?;

    // Check for errors
    if let Some(status) = json.get("playabilityStatus") {
        if status.get("status").and_then(|s| s.as_str()) == Some("ERROR") {
            return Err(ExtractError::VideoNotFound);
        }
    }

    // Extract video details
    let video_details = json.get("videoDetails")
        .ok_or_else(|| ExtractError::ParseError("No video details".into()))?;

    let title = video_details
        .get("title")
        .and_then(|t| t.as_str())
        .unwrap_or("Unknown")
        .to_string();

    let thumbnail = video_details
        .get("thumbnail")
        .and_then(|t| t.get("thumbnails"))
        .and_then(|t| t.as_array())
        .and_then(|t| t.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    let duration = video_details
        .get("lengthSeconds")
        .and_then(|l| l.as_str())
        .and_then(|s| s.parse().ok());

    let uploader = video_details
        .get("author")
        .and_then(|a| a.as_str())
        .map(|s| s.to_string());

    // Extract formats
    let mut formats = Vec::new();

    // Progressive formats (video + audio combined)
    if let Some(streaming_formats) = json
        .get("streamingData")
        .and_then(|sd| sd.get("formats"))
        .and_then(|f| f.as_array())
    {
        for f in streaming_formats {
            if let Some(format) = parse_format(f) {
                formats.push(format);
            }
        }
    }

    // Adaptive formats (video or audio only)
    if let Some(adaptive_formats) = json
        .get("streamingData")
        .and_then(|sd| sd.get("adaptiveFormats"))
        .and_then(|f| f.as_array())
    {
        for f in adaptive_formats {
            if let Some(format) = parse_format(f) {
                formats.push(format);
            }
        }
    }

    if formats.is_empty() {
        return Err(ExtractError::ParseError("No formats found".into()));
    }

    Ok(VideoInfo {
        id: video_id,
        title,
        thumbnail,
        duration,
        uploader,
        formats,
        site: "YouTube".to_string(),
    })
}

fn parse_format(f: &Value) -> Option<VideoFormat> {
    let itag = f.get("itag")?.as_u64()?;
    let mime_type = f.get("mimeType")?.as_str()?;
    let url = f.get("url").and_then(|u| u.as_str())?;

    let has_video = mime_type.starts_with("video/");
    let has_audio = mime_type.starts_with("audio/") || mime_type.contains("audio");

    let ext = if mime_type.contains("mp4") {
        "mp4"
    } else if mime_type.contains("webm") {
        "webm"
    } else if mime_type.contains("3gpp") {
        "3gp"
    } else {
        "unknown"
    };

    let quality = if has_video {
        f.get("qualityLabel")
            .and_then(|q| q.as_str())
            .unwrap_or("unknown")
            .to_string()
    } else {
        let bitrate = f.get("bitrate").and_then(|b| b.as_u64()).unwrap_or(0);
        format!("{}kbps", bitrate / 1000)
    };

    let filesize = f
        .get("contentLength")
        .and_then(|cl| cl.as_str())
        .and_then(|s| s.parse().ok());

    Some(VideoFormat {
        format_id: itag.to_string(),
        ext: ext.to_string(),
        quality,
        url: url.to_string(),
        filesize,
        has_video,
        has_audio,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_youtube_url() {
        assert!(is_youtube_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
        assert!(is_youtube_url("https://youtu.be/dQw4w9WgXcQ"));
        assert!(is_youtube_url("https://www.youtube.com/shorts/abc12345678"));
        assert!(!is_youtube_url("https://twitter.com/user/status/123"));
    }

    #[test]
    fn test_extract_video_id() {
        assert_eq!(
            extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
        assert_eq!(
            extract_video_id("https://youtu.be/dQw4w9WgXcQ"),
            Some("dQw4w9WgXcQ".to_string())
        );
    }
}

use super::{ExtractError, VideoFormat, VideoInfo};
use regex::Regex;
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

pub fn is_twitter_url(url: &str) -> bool {
    let patterns = [
        r"(?:https?://)?(?:www\.)?twitter\.com/\w+/status/\d+",
        r"(?:https?://)?(?:www\.)?x\.com/\w+/status/\d+",
        r"(?:https?://)?(?:mobile\.)?twitter\.com/\w+/status/\d+",
        r"(?:https?://)?(?:mobile\.)?x\.com/\w+/status/\d+",
    ];

    patterns.iter().any(|p| {
        Regex::new(p)
            .map(|re| re.is_match(url))
            .unwrap_or(false)
    })
}

fn extract_tweet_id(url: &str) -> Option<String> {
    Regex::new(r"/status/(\d+)")
        .ok()?
        .captures(url)?
        .get(1)
        .map(|m| m.as_str().to_string())
}

pub async fn extract(url: &str) -> Result<VideoInfo, ExtractError> {
    let tweet_id = extract_tweet_id(url)
        .ok_or_else(|| ExtractError::ParseError("Could not extract tweet ID".into()))?;

    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(10))
        .build()?;

    // Try vxtwitter API first (more reliable)
    let vx_result = try_vxtwitter(&client, &tweet_id).await;
    if let Ok(info) = vx_result {
        return Ok(info);
    }

    // Fallback to syndication API
    let syndication_result = try_syndication(&client, &tweet_id).await;
    if let Ok(info) = syndication_result {
        return Ok(info);
    }

    // If all methods fail, return error with helpful message
    Err(ExtractError::ParseError(
        "Could not extract video from this tweet. The tweet may not contain a video, or the video may be protected.".into()
    ))
}

async fn try_vxtwitter(client: &Client, tweet_id: &str) -> Result<VideoInfo, ExtractError> {
    // Use vxtwitter/fixupx API
    let api_url = format!("https://api.vxtwitter.com/Twitter/status/{}", tweet_id);

    let response = client.get(&api_url).send().await?;

    if !response.status().is_success() {
        return Err(ExtractError::VideoNotFound);
    }

    let json: Value = response.json().await?;

    let title = json
        .get("text")
        .and_then(|t| t.as_str())
        .map(|s| {
            if s.len() > 100 {
                format!("{}...", &s[..100])
            } else {
                s.to_string()
            }
        })
        .unwrap_or_else(|| format!("Twitter Video {}", tweet_id));

    let uploader = json
        .get("user_name")
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());

    let mut formats = Vec::new();

    // Extract from media_extended array
    if let Some(media) = json.get("media_extended").and_then(|m| m.as_array()) {
        for (idx, item) in media.iter().enumerate() {
            if item.get("type").and_then(|t| t.as_str()) != Some("video") {
                continue;
            }

            if let Some(video_url) = item.get("url").and_then(|u| u.as_str()) {
                let quality = item
                    .get("size")
                    .and_then(|s| s.get("height"))
                    .and_then(|h| h.as_u64())
                    .map(|h| format!("{}p", h))
                    .unwrap_or_else(|| "unknown".to_string());

                formats.push(VideoFormat {
                    format_id: format!("twitter_{}", idx),
                    ext: "mp4".to_string(),
                    quality,
                    url: video_url.to_string(),
                    filesize: None,
                    has_video: true,
                    has_audio: true,
                });
            }
        }
    }

    // Also check mediaURLs array
    if formats.is_empty() {
        if let Some(urls) = json.get("mediaURLs").and_then(|m| m.as_array()) {
            for (idx, url_val) in urls.iter().enumerate() {
                if let Some(video_url) = url_val.as_str() {
                    if video_url.contains(".mp4") || video_url.contains("video") {
                        formats.push(VideoFormat {
                            format_id: format!("twitter_{}", idx),
                            ext: "mp4".to_string(),
                            quality: "unknown".to_string(),
                            url: video_url.to_string(),
                            filesize: None,
                            has_video: true,
                            has_audio: true,
                        });
                    }
                }
            }
        }
    }

    if formats.is_empty() {
        return Err(ExtractError::ParseError("No video found in tweet".into()));
    }

    let thumbnail = json
        .get("media_extended")
        .and_then(|m| m.as_array())
        .and_then(|m| m.first())
        .and_then(|m| m.get("thumbnail_url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    Ok(VideoInfo {
        id: tweet_id.to_string(),
        title,
        thumbnail,
        duration: None,
        uploader,
        formats,
        site: "Twitter".to_string(),
    })
}

async fn try_syndication(client: &Client, tweet_id: &str) -> Result<VideoInfo, ExtractError> {
    let api_url = format!(
        "https://cdn.syndication.twimg.com/tweet-result?id={}&lang=en&token=0",
        tweet_id
    );

    let response = client.get(&api_url).send().await?;

    if !response.status().is_success() {
        return Err(ExtractError::VideoNotFound);
    }

    let json: Value = response.json().await?;

    let title = json
        .get("text")
        .and_then(|t| t.as_str())
        .map(|s| {
            if s.len() > 100 {
                format!("{}...", &s[..100])
            } else {
                s.to_string()
            }
        })
        .unwrap_or_else(|| format!("Twitter Video {}", tweet_id));

    let uploader = json
        .get("user")
        .and_then(|u| u.get("name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());

    let thumbnail = json
        .get("mediaDetails")
        .and_then(|m| m.as_array())
        .and_then(|m| m.first())
        .and_then(|m| m.get("media_url_https"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    let mut formats = Vec::new();

    if let Some(media_details) = json.get("mediaDetails").and_then(|m| m.as_array()) {
        for media in media_details {
            if media.get("type").and_then(|t| t.as_str()) != Some("video") {
                continue;
            }

            if let Some(variants) = media
                .get("video_info")
                .and_then(|v| v.get("variants"))
                .and_then(|v| v.as_array())
            {
                for (idx, variant) in variants.iter().enumerate() {
                    let content_type = variant
                        .get("content_type")
                        .and_then(|c| c.as_str())
                        .unwrap_or("");

                    if !content_type.contains("video") {
                        continue;
                    }

                    let url = variant
                        .get("url")
                        .and_then(|u| u.as_str())
                        .map(|s| s.to_string());

                    if let Some(url) = url {
                        let bitrate = variant.get("bitrate").and_then(|b| b.as_u64());
                        let quality = match bitrate {
                            Some(b) if b >= 2000000 => "1080p".to_string(),
                            Some(b) if b >= 1000000 => "720p".to_string(),
                            Some(b) if b >= 500000 => "480p".to_string(),
                            Some(b) => format!("{}kbps", b / 1000),
                            None => format!("variant_{}", idx),
                        };

                        formats.push(VideoFormat {
                            format_id: format!("twitter_{}", idx),
                            ext: "mp4".to_string(),
                            quality,
                            url,
                            filesize: None,
                            has_video: true,
                            has_audio: true,
                        });
                    }
                }
            }
        }
    }

    if formats.is_empty() {
        return Err(ExtractError::ParseError("No video found in tweet".into()));
    }

    formats.sort_by(|a, b| {
        let quality_order = |q: &str| -> u32 {
            if q.contains("1080") { 4 }
            else if q.contains("720") { 3 }
            else if q.contains("480") { 2 }
            else if q.contains("360") { 1 }
            else { 0 }
        };
        quality_order(&b.quality).cmp(&quality_order(&a.quality))
    });

    Ok(VideoInfo {
        id: tweet_id.to_string(),
        title,
        thumbnail,
        duration: None,
        uploader,
        formats,
        site: "Twitter".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_twitter_url() {
        assert!(is_twitter_url("https://twitter.com/user/status/123456789"));
        assert!(is_twitter_url("https://x.com/user/status/123456789"));
        assert!(!is_twitter_url("https://youtube.com/watch?v=abc"));
    }

    #[test]
    fn test_extract_tweet_id() {
        assert_eq!(
            extract_tweet_id("https://twitter.com/user/status/123456789"),
            Some("123456789".to_string())
        );
    }
}

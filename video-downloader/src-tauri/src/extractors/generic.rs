use super::{ExtractError, VideoFormat, VideoInfo};
use regex::Regex;
use reqwest::Client;
use url::Url;

pub async fn extract(url: &str) -> Result<VideoInfo, ExtractError> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()?;

    let response = client.get(url).send().await?;
    let html = response.text().await?;

    // Extract page title
    let title = extract_title(&html).unwrap_or_else(|| "Unknown Video".to_string());

    // Try to find video URLs in the page
    let mut formats = Vec::new();

    // Look for direct video links
    let video_patterns = [
        r#"<source[^>]+src=["']([^"']+\.mp4[^"']*)["']"#,
        r#"<video[^>]+src=["']([^"']+\.mp4[^"']*)["']"#,
        r#"["']([^"']+\.mp4)["']"#,
        r#"["']([^"']+\.webm)["']"#,
        r#"["'](https?://[^"']+/video[^"']*)["']"#,
    ];

    for (_idx, pattern) in video_patterns.iter().enumerate() {
        if let Ok(re) = Regex::new(pattern) {
            for cap in re.captures_iter(&html) {
                if let Some(video_url) = cap.get(1) {
                    let video_url = video_url.as_str();

                    // Resolve relative URLs
                    let full_url = resolve_url(url, video_url);

                    // Check if it's a valid video URL
                    if is_valid_video_url(&full_url) {
                        let ext = if full_url.contains(".webm") {
                            "webm"
                        } else {
                            "mp4"
                        };

                        formats.push(VideoFormat {
                            format_id: format!("generic_{}", formats.len()),
                            ext: ext.to_string(),
                            quality: "unknown".to_string(),
                            url: full_url,
                            filesize: None,
                            has_video: true,
                            has_audio: true,
                        });
                    }
                }
            }
        }
    }

    // Look for m3u8 (HLS) streams
    let hls_patterns = [
        r#"["']([^"']+\.m3u8[^"']*)["']"#,
        r#"src:\s*["']([^"']+\.m3u8[^"']*)["']"#,
    ];

    for pattern in hls_patterns.iter() {
        if let Ok(re) = Regex::new(pattern) {
            for cap in re.captures_iter(&html) {
                if let Some(hls_url) = cap.get(1) {
                    let full_url = resolve_url(url, hls_url.as_str());

                    formats.push(VideoFormat {
                        format_id: format!("hls_{}", formats.len()),
                        ext: "m3u8".to_string(),
                        quality: "HLS stream".to_string(),
                        url: full_url,
                        filesize: None,
                        has_video: true,
                        has_audio: true,
                    });
                }
            }
        }
    }

    // Deduplicate formats by URL
    formats.dedup_by(|a, b| a.url == b.url);

    if formats.is_empty() {
        return Err(ExtractError::ParseError(
            "No video found on this page. Try YouTube, Twitter, or pages with direct video links.".into(),
        ));
    }

    // Extract thumbnail if available
    let thumbnail = extract_og_image(&html);

    // Generate a unique ID from URL
    let id = Url::parse(url)
        .map(|u| u.path().to_string())
        .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());

    Ok(VideoInfo {
        id,
        title,
        thumbnail,
        duration: None,
        uploader: None,
        formats,
        site: "Generic".to_string(),
    })
}

fn extract_title(html: &str) -> Option<String> {
    // Try og:title first
    if let Ok(re) = Regex::new(r#"<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']"#) {
        if let Some(cap) = re.captures(html) {
            return cap.get(1).map(|m| m.as_str().to_string());
        }
    }

    // Fallback to <title> tag
    if let Ok(re) = Regex::new(r#"<title>([^<]+)</title>"#) {
        if let Some(cap) = re.captures(html) {
            return cap.get(1).map(|m| html_decode(m.as_str()));
        }
    }

    None
}

fn extract_og_image(html: &str) -> Option<String> {
    if let Ok(re) = Regex::new(r#"<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']"#) {
        if let Some(cap) = re.captures(html) {
            return cap.get(1).map(|m| m.as_str().to_string());
        }
    }
    None
}

fn resolve_url(base: &str, relative: &str) -> String {
    if relative.starts_with("http://") || relative.starts_with("https://") {
        return relative.to_string();
    }

    if relative.starts_with("//") {
        return format!("https:{}", relative);
    }

    if let Ok(base_url) = Url::parse(base) {
        if let Ok(resolved) = base_url.join(relative) {
            return resolved.to_string();
        }
    }

    relative.to_string()
}

fn is_valid_video_url(url: &str) -> bool {
    // Filter out common non-video URLs
    let blacklist = [
        "player.js",
        "video.js",
        "analytics",
        "tracking",
        "pixel",
        ".css",
        ".js",
        "thumbnail",
        "poster",
    ];

    for item in blacklist.iter() {
        if url.to_lowercase().contains(item) {
            return false;
        }
    }

    // Must look like a video URL
    url.contains(".mp4")
        || url.contains(".webm")
        || url.contains(".m3u8")
        || url.contains("/video")
}

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

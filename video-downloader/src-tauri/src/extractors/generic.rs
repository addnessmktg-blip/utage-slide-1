use super::{ExtractError, VideoFormat, VideoInfo};
use regex::Regex;
use reqwest::Client;
use url::Url;

pub async fn extract(url: &str) -> Result<VideoInfo, ExtractError> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()?;

    let response = client.get(url).send().await?;
    let html = response.text().await?;

    // Extract page title
    let title = extract_title(&html).unwrap_or_else(|| "Unknown Video".to_string());

    // Try to find video URLs in the page
    let mut formats = Vec::new();

    // Look for direct video links - expanded patterns
    let video_patterns = [
        // Standard HTML5 video elements
        r#"<source[^>]+src=["']([^"']+\.mp4[^"']*)["']"#,
        r#"<video[^>]+src=["']([^"']+\.mp4[^"']*)["']"#,
        r#"<video[^>]+src=["']([^"']+\.webm[^"']*)["']"#,
        // Direct URLs in page
        r#"["']([^"'\s]+\.mp4(?:\?[^"']*)?)["']"#,
        r#"["']([^"'\s]+\.webm(?:\?[^"']*)?)["']"#,
        r#"["']([^"'\s]+\.mov(?:\?[^"']*)?)["']"#,
        // Video hosting patterns
        r#"["'](https?://[^"'\s]+/video/[^"'\s]+)["']"#,
        r#"["'](https?://[^"'\s]+/videos/[^"'\s]+)["']"#,
        r#"["'](https?://[^"'\s]+/media/[^"'\s]+\.mp4[^"']*)["']"#,
        // Cloudfront and CDN patterns
        r#"["'](https?://[^"'\s]*cloudfront[^"'\s]+\.mp4[^"']*)["']"#,
        r#"["'](https?://[^"'\s]*cdn[^"'\s]+\.mp4[^"']*)["']"#,
        // Vimeo player patterns
        r#"["'](https?://player\.vimeo\.com/video/\d+)["']"#,
        // Wistia patterns
        r#"["'](https?://fast\.wistia\.[^"'\s]+)["']"#,
        // Generic video file patterns in JSON/JS
        r#"["\']?(?:url|src|file|source|video_url|videoUrl|video)["\']?\s*[:=]\s*["']([^"']+\.mp4[^"']*)["']"#,
        r#"["\']?(?:url|src|file|source|video_url|videoUrl|video)["\']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']"#,
        // Data attributes
        r#"data-(?:src|video|url)=["']([^"']+\.mp4[^"']*)["']"#,
        r#"data-(?:src|video|url)=["']([^"']+\.m3u8[^"']*)["']"#,
    ];

    for (_idx, pattern) in video_patterns.iter().enumerate() {
        if let Ok(re) = Regex::new(pattern) {
            for cap in re.captures_iter(&html) {
                if let Some(video_url) = cap.get(1) {
                    let video_url = video_url.as_str();

                    // Resolve relative URLs
                    let full_url = resolve_url(url, video_url);

                    // Check if it's a valid video URL
                    if is_valid_video_url(&full_url) && !formats.iter().any(|f: &VideoFormat| f.url == full_url) {
                        let ext = if full_url.contains(".webm") {
                            "webm"
                        } else if full_url.contains(".mov") {
                            "mov"
                        } else if full_url.contains(".m3u8") {
                            "m3u8"
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
        r#"["']([^"'\s]+\.m3u8(?:\?[^"']*)?)["']"#,
        r#"src:\s*["']([^"']+\.m3u8[^"']*)["']"#,
        r#"["\']?(?:hlsUrl|hls_url|playlist)["\']?\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']"#,
    ];

    for pattern in hls_patterns.iter() {
        if let Ok(re) = Regex::new(pattern) {
            for cap in re.captures_iter(&html) {
                if let Some(hls_url) = cap.get(1) {
                    let full_url = resolve_url(url, hls_url.as_str());

                    if !formats.iter().any(|f| f.url == full_url) {
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
    }

    // Look for iframe embeds that might contain videos
    if formats.is_empty() {
        let iframe_patterns = [
            r#"<iframe[^>]+src=["']([^"']+)["']"#,
        ];

        for pattern in iframe_patterns.iter() {
            if let Ok(re) = Regex::new(pattern) {
                for cap in re.captures_iter(&html) {
                    if let Some(iframe_url) = cap.get(1) {
                        let iframe_url = iframe_url.as_str();
                        // Check if iframe contains known video platforms
                        if iframe_url.contains("youtube")
                            || iframe_url.contains("vimeo")
                            || iframe_url.contains("wistia")
                            || iframe_url.contains("player")
                        {
                            let full_url = resolve_url(url, iframe_url);
                            formats.push(VideoFormat {
                                format_id: format!("embed_{}", formats.len()),
                                ext: "embed".to_string(),
                                quality: "embedded".to_string(),
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
    }

    // Deduplicate formats by URL
    formats.dedup_by(|a, b| a.url == b.url);

    if formats.is_empty() {
        return Err(ExtractError::ParseError(
            "No video found on this page. The video may be loaded dynamically via JavaScript, which requires browser automation to extract.".into(),
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

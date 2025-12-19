# 次世代動画ダウンローダー 詳細設計書

## 推奨アーキテクチャ: Tauri 2.0 + Rust Backend

---

## 1. システム概要

### 1.1 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Tauri Application                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    Frontend (WebView)                                 │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │   URL入力   │  │ キュー管理  │  │ 進捗表示    │  │  設定画面   │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  │                                                                       │  │
│  │  Tech: React 18 + TypeScript + Tailwind CSS + shadcn/ui              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    │ Tauri IPC (invoke/listen)              │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    Backend (Rust Core)                                │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │ Extractors  │  │ Downloader  │  │ Queue Mgr   │  │ FFmpeg Ctrl │  │  │
│  │  │             │  │             │  │             │  │             │  │  │
│  │  │ - YouTube   │  │ - HTTP      │  │ - 並列制御  │  │ - Muxing    │  │  │
│  │  │ - Twitter   │  │ - HLS       │  │ - リトライ  │  │ - 変換      │  │  │
│  │  │ - TikTok    │  │ - DASH      │  │ - 永続化    │  │ - 字幕      │  │  │
│  │  │ - Vimeo     │  │             │  │             │  │             │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  │                                                                       │  │
│  │  Tech: Rust + tokio + reqwest + serde                                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    │ Process Spawn                          │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    FFmpeg Sidecar                                     │  │
│  │  - 動画/音声のMuxing                                                  │  │
│  │  - フォーマット変換 (MP4, MKV, WebM, MP3, M4A, FLAC)                  │  │
│  │  - 字幕埋め込み                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 データフロー

```
URL入力 → 解析 → メタデータ取得 → フォーマット選択 → ダウンロード → 後処理 → 完了

詳細:
1. [Frontend] ユーザーがURLを入力
2. [Backend]  Extractorが適切なパーサーを選択
3. [Backend]  サイトにアクセスしてメタデータ取得
4. [Frontend] 利用可能なフォーマットを表示
5. [Frontend] ユーザーがフォーマット・品質を選択
6. [Backend]  Downloaderがセグメントをダウンロード
7. [Backend]  FFmpegで結合・変換
8. [Frontend] 完了通知
```

---

## 2. フロントエンド設計

### 2.1 コンポーネント構成

```
src/
├── components/
│   ├── layout/
│   │   ├── Header.tsx          # ロゴ・設定ボタン
│   │   ├── Sidebar.tsx         # ナビゲーション
│   │   └── MainContent.tsx     # メインエリア
│   │
│   ├── download/
│   │   ├── UrlInput.tsx        # URL入力フォーム
│   │   ├── VideoPreview.tsx    # サムネイル・メタデータ表示
│   │   ├── FormatSelector.tsx  # 品質・形式選択
│   │   ├── DownloadButton.tsx  # ダウンロード開始ボタン
│   │   └── ProgressBar.tsx     # 進捗バー
│   │
│   ├── queue/
│   │   ├── QueueList.tsx       # ダウンロードキュー一覧
│   │   ├── QueueItem.tsx       # 個別アイテム
│   │   └── QueueControls.tsx   # 一括操作（一時停止・再開・削除）
│   │
│   ├── playlist/
│   │   ├── PlaylistView.tsx    # プレイリスト表示
│   │   └── PlaylistItem.tsx    # 個別動画の選択
│   │
│   ├── settings/
│   │   ├── SettingsModal.tsx   # 設定モーダル
│   │   ├── DownloadSettings.tsx # DL先・同時接続数
│   │   ├── FormatSettings.tsx  # デフォルト形式
│   │   └── ProxySettings.tsx   # プロキシ設定
│   │
│   └── ui/                     # shadcn/ui コンポーネント
│       ├── button.tsx
│       ├── input.tsx
│       ├── select.tsx
│       ├── progress.tsx
│       ├── toast.tsx
│       └── ...
│
├── hooks/
│   ├── useDownload.ts          # ダウンロード操作
│   ├── useQueue.ts             # キュー管理
│   ├── useSettings.ts          # 設定管理
│   └── useTauri.ts             # Tauri IPC ラッパー
│
├── stores/
│   ├── downloadStore.ts        # Zustand ストア
│   ├── queueStore.ts
│   └── settingsStore.ts
│
├── lib/
│   ├── tauri.ts                # Tauri コマンド呼び出し
│   ├── formats.ts              # フォーマット定義
│   └── utils.ts                # ユーティリティ
│
├── types/
│   ├── video.ts                # VideoInfo, Format等
│   ├── download.ts             # DownloadTask, Progress等
│   └── settings.ts             # Settings
│
├── App.tsx
└── main.tsx
```

### 2.2 主要な型定義

```typescript
// types/video.ts
export interface VideoInfo {
  id: string;
  title: string;
  description?: string;
  thumbnail?: string;
  duration: number;       // 秒
  uploader: string;
  uploadDate?: string;
  viewCount?: number;
  formats: VideoFormat[];
  subtitles: Subtitle[];
  isPlaylist: boolean;
  playlistItems?: PlaylistItem[];
}

export interface VideoFormat {
  formatId: string;
  ext: string;            // mp4, webm, etc.
  quality: string;        // 1080p, 720p, etc.
  resolution?: string;    // 1920x1080
  vcodec?: string;        // h264, vp9, av1
  acodec?: string;        // aac, opus
  filesize?: number;      // bytes
  tbr?: number;           // total bitrate
  hasVideo: boolean;
  hasAudio: boolean;
}

export interface Subtitle {
  lang: string;
  langName: string;
  ext: string;            // vtt, srt
  url: string;
}

export interface PlaylistItem {
  index: number;
  id: string;
  title: string;
  duration: number;
  selected: boolean;
}

// types/download.ts
export interface DownloadTask {
  id: string;
  videoInfo: VideoInfo;
  selectedFormat: VideoFormat;
  selectedAudioFormat?: VideoFormat;  // 別トラックの場合
  subtitleLangs: string[];
  embedSubtitles: boolean;
  outputPath: string;
  outputFormat: OutputFormat;
  status: DownloadStatus;
  progress: DownloadProgress;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export type DownloadStatus =
  | 'pending'
  | 'extracting'
  | 'downloading'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'paused'
  | 'cancelled';

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  speed: number;          // bytes/sec
  eta: number;            // 残り秒数
  percentage: number;     // 0-100
  currentSegment?: number;
  totalSegments?: number;
}

export type OutputFormat = 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a' | 'flac';

// types/settings.ts
export interface Settings {
  downloadPath: string;
  maxConcurrentDownloads: number;
  defaultVideoFormat: string;     // "best", "1080p", "720p"
  defaultAudioFormat: string;     // "best", "320k", "256k"
  defaultOutputFormat: OutputFormat;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  autoSelectSubtitles: string[];  // ["ja", "en"]
  proxy?: ProxySettings;
  theme: 'dark' | 'light' | 'system';
}

export interface ProxySettings {
  enabled: boolean;
  host: string;
  port: number;
  username?: string;
  password?: string;
}
```

### 2.3 UI デザイン仕様

**カラーパレット（ダークテーマ）**
```css
:root {
  --background: #0a0a0a;
  --foreground: #fafafa;
  --card: #171717;
  --card-foreground: #fafafa;
  --primary: #3b82f6;      /* Blue-500 */
  --primary-foreground: #fafafa;
  --secondary: #262626;
  --muted: #404040;
  --accent: #22c55e;       /* Green-500 for success */
  --destructive: #ef4444;  /* Red-500 for errors */
  --border: #262626;
  --ring: #3b82f6;
}
```

**レイアウト**
```
┌──────────────────────────────────────────────────────────────────┐
│  [Logo]  Video Downloader                        [Settings] [─□×] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  🔗 動画URLを入力してください                              │  │
│  │  ┌──────────────────────────────────────────────┐ [解析]  │  │
│  │  │ https://www.youtube.com/watch?v=...          │         │  │
│  │  └──────────────────────────────────────────────┘         │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  [Thumbnail]  │  Title: Example Video                     │  │
│  │               │  Channel: Example Channel                 │  │
│  │               │  Duration: 10:30                          │  │
│  │               │                                           │  │
│  │               │  Format: [1080p ▼]  Audio: [Best ▼]      │  │
│  │               │  Output: [MP4 ▼]    Subtitles: [日本語 ✓] │  │
│  │               │                                           │  │
│  │               │  [████████████████░░░░] 75% - 2.5 MB/s    │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ダウンロードキュー (3)                              [全て開始]  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ✓ Video 1                    Completed    10.5 MB        │  │
│  │  ↓ Video 2                    Downloading  [████░░] 45%   │  │
│  │  ⏸ Video 3                    Paused       0%             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. バックエンド設計 (Rust)

### 3.1 モジュール構成

```
src-tauri/src/
├── main.rs                 # エントリーポイント
├── lib.rs                  # ライブラリルート
│
├── commands/               # Tauri コマンド
│   ├── mod.rs
│   ├── extract.rs          # URL解析・情報取得
│   ├── download.rs         # ダウンロード操作
│   ├── queue.rs            # キュー管理
│   └── settings.rs         # 設定操作
│
├── extractors/             # サイト別エクストラクター
│   ├── mod.rs
│   ├── traits.rs           # Extractor trait定義
│   ├── youtube.rs
│   ├── twitter.rs
│   ├── tiktok.rs
│   ├── vimeo.rs
│   └── generic.rs          # 汎用（埋め込み動画等）
│
├── downloader/             # ダウンロード処理
│   ├── mod.rs
│   ├── http.rs             # 単純HTTPダウンロード
│   ├── hls.rs              # HLS (m3u8) ダウンロード
│   ├── dash.rs             # DASH (mpd) ダウンロード
│   └── progress.rs         # 進捗管理
│
├── ffmpeg/                 # FFmpeg連携
│   ├── mod.rs
│   ├── muxer.rs            # 動画/音声結合
│   ├── converter.rs        # フォーマット変換
│   └── subtitles.rs        # 字幕処理
│
├── queue/                  # キュー管理
│   ├── mod.rs
│   ├── manager.rs          # キューマネージャー
│   └── persistence.rs      # 永続化
│
├── config/                 # 設定管理
│   ├── mod.rs
│   └── settings.rs
│
├── utils/                  # ユーティリティ
│   ├── mod.rs
│   ├── crypto.rs           # 復号処理
│   └── sanitize.rs         # ファイル名サニタイズ
│
└── error.rs                # エラー型定義
```

### 3.2 Extractor Trait

```rust
// extractors/traits.rs
use async_trait::async_trait;
use crate::error::Result;

#[async_trait]
pub trait Extractor: Send + Sync {
    /// このExtractorが対応するURLかどうか判定
    fn can_handle(&self, url: &str) -> bool;

    /// URLから動画情報を抽出
    async fn extract(&self, url: &str, options: &ExtractOptions) -> Result<VideoInfo>;

    /// プレイリストの場合、動画一覧を取得
    async fn extract_playlist(&self, url: &str, options: &ExtractOptions) -> Result<Vec<VideoInfo>>;

    /// サイト名を取得
    fn site_name(&self) -> &'static str;
}

#[derive(Debug, Clone)]
pub struct ExtractOptions {
    pub cookies: Option<String>,
    pub proxy: Option<ProxyConfig>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub thumbnail: Option<String>,
    pub duration: u64,
    pub uploader: String,
    pub upload_date: Option<String>,
    pub view_count: Option<u64>,
    pub formats: Vec<VideoFormat>,
    pub subtitles: Vec<Subtitle>,
    pub is_live: bool,
    pub playlist_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoFormat {
    pub format_id: String,
    pub ext: String,
    pub quality: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f32>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub filesize: Option<u64>,
    pub tbr: Option<f32>,
    pub url: String,
    pub has_video: bool,
    pub has_audio: bool,
    pub is_hls: bool,
    pub is_dash: bool,
}
```

### 3.3 YouTube Extractor 実装概要

```rust
// extractors/youtube.rs
use super::traits::{Extractor, ExtractOptions, VideoInfo, VideoFormat};
use crate::error::{Error, Result};
use async_trait::async_trait;
use regex::Regex;
use reqwest::Client;
use serde_json::Value;

pub struct YouTubeExtractor {
    client: Client,
}

impl YouTubeExtractor {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
                .build()
                .unwrap(),
        }
    }

    /// YouTube Data API なしで動画情報を取得
    async fn get_player_response(&self, video_id: &str) -> Result<Value> {
        // 方法1: /youtubei/v1/player API
        let api_url = "https://www.youtube.com/youtubei/v1/player";
        let payload = serde_json::json!({
            "videoId": video_id,
            "context": {
                "client": {
                    "clientName": "ANDROID",
                    "clientVersion": "19.09.37",
                    "androidSdkVersion": 30,
                }
            }
        });

        let response = self.client
            .post(api_url)
            .json(&payload)
            .send()
            .await?;

        let json: Value = response.json().await?;
        Ok(json)
    }

    fn parse_formats(&self, player_response: &Value) -> Vec<VideoFormat> {
        let mut formats = Vec::new();

        // streamingData.formats (progressive streams)
        if let Some(streaming_formats) = player_response
            .get("streamingData")
            .and_then(|sd| sd.get("formats"))
            .and_then(|f| f.as_array())
        {
            for f in streaming_formats {
                if let Some(format) = self.parse_single_format(f, false) {
                    formats.push(format);
                }
            }
        }

        // streamingData.adaptiveFormats (DASH)
        if let Some(adaptive_formats) = player_response
            .get("streamingData")
            .and_then(|sd| sd.get("adaptiveFormats"))
            .and_then(|f| f.as_array())
        {
            for f in adaptive_formats {
                if let Some(format) = self.parse_single_format(f, true) {
                    formats.push(format);
                }
            }
        }

        formats
    }

    fn parse_single_format(&self, f: &Value, is_adaptive: bool) -> Option<VideoFormat> {
        let itag = f.get("itag")?.as_u64()?;
        let mime_type = f.get("mimeType")?.as_str()?;
        let url = f.get("url").and_then(|u| u.as_str()).map(String::from);

        // signatureCipher の場合はデコードが必要
        let url = url.or_else(|| {
            f.get("signatureCipher")
                .and_then(|sc| sc.as_str())
                .and_then(|sc| self.decode_signature_cipher(sc))
        })?;

        let (vcodec, acodec) = self.parse_mime_type(mime_type);

        Some(VideoFormat {
            format_id: itag.to_string(),
            ext: self.get_extension_from_mime(mime_type),
            quality: f.get("qualityLabel").and_then(|q| q.as_str()).map(String::from),
            width: f.get("width").and_then(|w| w.as_u64()).map(|w| w as u32),
            height: f.get("height").and_then(|h| h.as_u64()).map(|h| h as u32),
            fps: f.get("fps").and_then(|fps| fps.as_f64()).map(|fps| fps as f32),
            vcodec,
            acodec,
            filesize: f.get("contentLength").and_then(|cl| cl.as_str()).and_then(|s| s.parse().ok()),
            tbr: f.get("bitrate").and_then(|b| b.as_f64()).map(|b| b as f32 / 1000.0),
            url,
            has_video: mime_type.starts_with("video/"),
            has_audio: mime_type.starts_with("audio/") || mime_type.contains("audio"),
            is_hls: false,
            is_dash: is_adaptive,
        })
    }
}

#[async_trait]
impl Extractor for YouTubeExtractor {
    fn can_handle(&self, url: &str) -> bool {
        let patterns = [
            r"(?:https?://)?(?:www\.)?youtube\.com/watch\?v=",
            r"(?:https?://)?(?:www\.)?youtube\.com/shorts/",
            r"(?:https?://)?youtu\.be/",
            r"(?:https?://)?(?:www\.)?youtube\.com/playlist\?list=",
        ];
        patterns.iter().any(|p| Regex::new(p).unwrap().is_match(url))
    }

    async fn extract(&self, url: &str, _options: &ExtractOptions) -> Result<VideoInfo> {
        let video_id = self.extract_video_id(url)?;
        let player_response = self.get_player_response(&video_id).await?;

        let video_details = player_response.get("videoDetails")
            .ok_or(Error::ExtractionFailed("No video details".into()))?;

        Ok(VideoInfo {
            id: video_id,
            title: video_details.get("title").and_then(|t| t.as_str()).unwrap_or("Unknown").to_string(),
            description: video_details.get("shortDescription").and_then(|d| d.as_str()).map(String::from),
            thumbnail: video_details.get("thumbnail")
                .and_then(|t| t.get("thumbnails"))
                .and_then(|t| t.as_array())
                .and_then(|t| t.last())
                .and_then(|t| t.get("url"))
                .and_then(|u| u.as_str())
                .map(String::from),
            duration: video_details.get("lengthSeconds")
                .and_then(|l| l.as_str())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0),
            uploader: video_details.get("author").and_then(|a| a.as_str()).unwrap_or("Unknown").to_string(),
            upload_date: None,
            view_count: video_details.get("viewCount").and_then(|v| v.as_str()).and_then(|s| s.parse().ok()),
            formats: self.parse_formats(&player_response),
            subtitles: self.extract_subtitles(&player_response),
            is_live: video_details.get("isLiveContent").and_then(|l| l.as_bool()).unwrap_or(false),
            playlist_index: None,
        })
    }

    async fn extract_playlist(&self, url: &str, options: &ExtractOptions) -> Result<Vec<VideoInfo>> {
        // プレイリスト処理の実装
        todo!()
    }

    fn site_name(&self) -> &'static str {
        "YouTube"
    }
}
```

### 3.4 HLS Downloader

```rust
// downloader/hls.rs
use crate::error::Result;
use m3u8_rs::{parse_playlist_res, Playlist};
use reqwest::Client;
use std::path::PathBuf;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use futures::stream::{self, StreamExt};

pub struct HlsDownloader {
    client: Client,
    max_concurrent: usize,
}

impl HlsDownloader {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            client: Client::new(),
            max_concurrent,
        }
    }

    pub async fn download(
        &self,
        m3u8_url: &str,
        output_path: &PathBuf,
        progress_tx: tokio::sync::mpsc::Sender<DownloadProgress>,
    ) -> Result<()> {
        // 1. m3u8マニフェストを取得
        let manifest = self.fetch_manifest(m3u8_url).await?;

        // 2. セグメントURLを抽出
        let segments = self.parse_segments(&manifest, m3u8_url)?;
        let total_segments = segments.len();

        // 3. 一時ディレクトリを作成
        let temp_dir = output_path.parent().unwrap().join(".tmp");
        tokio::fs::create_dir_all(&temp_dir).await?;

        // 4. セグメントを並列ダウンロード
        let downloaded = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));

        let results: Vec<Result<PathBuf>> = stream::iter(segments.into_iter().enumerate())
            .map(|(idx, segment_url)| {
                let client = self.client.clone();
                let temp_dir = temp_dir.clone();
                let downloaded = downloaded.clone();
                let progress_tx = progress_tx.clone();

                async move {
                    let segment_path = temp_dir.join(format!("segment_{:05}.ts", idx));

                    // セグメントをダウンロード
                    let response = client.get(&segment_url).send().await?;
                    let bytes = response.bytes().await?;

                    let mut file = File::create(&segment_path).await?;
                    file.write_all(&bytes).await?;

                    // 進捗を更新
                    let current = downloaded.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    let _ = progress_tx.send(DownloadProgress {
                        current_segment: current,
                        total_segments,
                        percentage: (current as f64 / total_segments as f64 * 100.0) as u8,
                    }).await;

                    Ok(segment_path)
                }
            })
            .buffer_unordered(self.max_concurrent)
            .collect()
            .await;

        // 5. エラーチェック
        let segment_paths: Vec<PathBuf> = results.into_iter().collect::<Result<Vec<_>>>()?;

        // 6. セグメントを結合
        self.concat_segments(&segment_paths, output_path).await?;

        // 7. 一時ファイルを削除
        tokio::fs::remove_dir_all(&temp_dir).await?;

        Ok(())
    }

    async fn fetch_manifest(&self, url: &str) -> Result<String> {
        let response = self.client.get(url).send().await?;
        Ok(response.text().await?)
    }

    fn parse_segments(&self, manifest: &str, base_url: &str) -> Result<Vec<String>> {
        let playlist = parse_playlist_res(manifest.as_bytes())
            .map_err(|e| crate::error::Error::ParseError(format!("{:?}", e)))?;

        match playlist {
            Playlist::MasterPlaylist(master) => {
                // 最高品質のバリアントを選択
                if let Some(variant) = master.variants.last() {
                    let variant_url = self.resolve_url(base_url, &variant.uri);
                    // 再帰的にバリアントプレイリストを取得
                    // (実際の実装では非同期で処理)
                    todo!()
                } else {
                    Err(crate::error::Error::ExtractionFailed("No variants".into()))
                }
            }
            Playlist::MediaPlaylist(media) => {
                Ok(media.segments.iter()
                    .map(|seg| self.resolve_url(base_url, &seg.uri))
                    .collect())
            }
        }
    }

    fn resolve_url(&self, base: &str, relative: &str) -> String {
        if relative.starts_with("http://") || relative.starts_with("https://") {
            relative.to_string()
        } else {
            let base_url = url::Url::parse(base).unwrap();
            base_url.join(relative).unwrap().to_string()
        }
    }

    async fn concat_segments(&self, segments: &[PathBuf], output: &PathBuf) -> Result<()> {
        let mut output_file = File::create(output).await?;

        for segment in segments {
            let data = tokio::fs::read(segment).await?;
            output_file.write_all(&data).await?;
        }

        Ok(())
    }
}
```

### 3.5 FFmpeg Sidecar 連携

```rust
// ffmpeg/muxer.rs
use crate::error::Result;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::api::process::{Command, CommandEvent};
use tokio::sync::mpsc;

pub struct FFmpegMuxer {
    ffmpeg_path: PathBuf,
}

impl FFmpegMuxer {
    pub fn new(ffmpeg_path: PathBuf) -> Self {
        Self { ffmpeg_path }
    }

    /// 動画と音声を結合
    pub async fn mux(
        &self,
        video_path: &PathBuf,
        audio_path: &PathBuf,
        output_path: &PathBuf,
        progress_tx: mpsc::Sender<MuxProgress>,
    ) -> Result<()> {
        let args = vec![
            "-i", video_path.to_str().unwrap(),
            "-i", audio_path.to_str().unwrap(),
            "-c", "copy",           // コーデックをコピー（再エンコードなし）
            "-y",                   // 上書き確認なし
            output_path.to_str().unwrap(),
        ];

        let (mut rx, _child) = Command::new_sidecar("ffmpeg")?
            .args(args)
            .spawn()
            .map_err(|e| crate::error::Error::FFmpegError(e.to_string()))?;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    // FFmpegの進捗をパース
                    if let Some(progress) = self.parse_progress(&line) {
                        let _ = progress_tx.send(progress).await;
                    }
                }
                CommandEvent::Terminated(payload) => {
                    if payload.code != Some(0) {
                        return Err(crate::error::Error::FFmpegError(
                            format!("FFmpeg exited with code {:?}", payload.code)
                        ));
                    }
                }
                _ => {}
            }
        }

        Ok(())
    }

    /// 字幕を埋め込み
    pub async fn embed_subtitles(
        &self,
        video_path: &PathBuf,
        subtitle_path: &PathBuf,
        output_path: &PathBuf,
    ) -> Result<()> {
        let args = vec![
            "-i", video_path.to_str().unwrap(),
            "-i", subtitle_path.to_str().unwrap(),
            "-c", "copy",
            "-c:s", "mov_text",     // MP4用字幕コーデック
            "-y",
            output_path.to_str().unwrap(),
        ];

        // 実行...
        todo!()
    }

    /// フォーマット変換
    pub async fn convert(
        &self,
        input_path: &PathBuf,
        output_path: &PathBuf,
        format: &str,
    ) -> Result<()> {
        let args = match format {
            "mp3" => vec![
                "-i", input_path.to_str().unwrap(),
                "-vn",              // 動画を除去
                "-acodec", "libmp3lame",
                "-ab", "320k",
                "-y",
                output_path.to_str().unwrap(),
            ],
            "m4a" => vec![
                "-i", input_path.to_str().unwrap(),
                "-vn",
                "-acodec", "aac",
                "-ab", "256k",
                "-y",
                output_path.to_str().unwrap(),
            ],
            // 他のフォーマット...
            _ => return Err(crate::error::Error::UnsupportedFormat(format.into())),
        };

        // 実行...
        todo!()
    }

    fn parse_progress(&self, line: &str) -> Option<MuxProgress> {
        // "time=00:01:23.45" のようなパターンを解析
        if line.contains("time=") {
            // パース処理
            None
        } else {
            None
        }
    }
}

#[derive(Debug, Clone)]
pub struct MuxProgress {
    pub time_processed: f64,  // 秒
    pub speed: f64,           // 1.0x, 2.0x等
}
```

### 3.6 Tauri コマンド

```rust
// commands/extract.rs
use tauri::State;
use crate::extractors::{ExtractorManager, ExtractOptions};
use crate::error::Result;

#[tauri::command]
pub async fn extract_video_info(
    url: String,
    extractor_manager: State<'_, ExtractorManager>,
) -> Result<VideoInfo> {
    let options = ExtractOptions::default();
    extractor_manager.extract(&url, &options).await
}

#[tauri::command]
pub async fn extract_playlist(
    url: String,
    extractor_manager: State<'_, ExtractorManager>,
) -> Result<Vec<VideoInfo>> {
    let options = ExtractOptions::default();
    extractor_manager.extract_playlist(&url, &options).await
}

// commands/download.rs
use tauri::{State, Window};
use crate::queue::QueueManager;

#[tauri::command]
pub async fn start_download(
    task_id: String,
    window: Window,
    queue_manager: State<'_, QueueManager>,
) -> Result<()> {
    queue_manager.start_task(&task_id, move |progress| {
        // 進捗をフロントエンドに送信
        let _ = window.emit("download-progress", (&task_id, &progress));
    }).await
}

#[tauri::command]
pub async fn pause_download(
    task_id: String,
    queue_manager: State<'_, QueueManager>,
) -> Result<()> {
    queue_manager.pause_task(&task_id).await
}

#[tauri::command]
pub async fn cancel_download(
    task_id: String,
    queue_manager: State<'_, QueueManager>,
) -> Result<()> {
    queue_manager.cancel_task(&task_id).await
}
```

---

## 4. ビルド・配布

### 4.1 FFmpeg のバンドル方式

**推奨: 最小構成のStatic FFmpegをSidecarとしてバンドル**

```toml
# src-tauri/tauri.conf.json
{
  "tauri": {
    "bundle": {
      "externalBin": [
        "binaries/ffmpeg"
      ]
    }
  }
}
```

**FFmpegビルドオプション（最小構成）**
```bash
./configure \
  --enable-static \
  --disable-shared \
  --disable-doc \
  --disable-ffplay \
  --disable-ffprobe \
  --enable-gpl \
  --enable-libx264 \
  --enable-libx265 \
  --enable-libvpx \
  --enable-libopus \
  --enable-libmp3lame \
  --enable-libfdk-aac \
  --disable-debug
```

サイズ目安: 約30-50MB（プラットフォーム別）

### 4.2 プラットフォーム別ビルド

```bash
# Windows
cargo tauri build --target x86_64-pc-windows-msvc

# macOS (Intel)
cargo tauri build --target x86_64-apple-darwin

# macOS (Apple Silicon)
cargo tauri build --target aarch64-apple-darwin

# Linux
cargo tauri build --target x86_64-unknown-linux-gnu
```

### 4.3 配布物サイズ見込み

| プラットフォーム | アプリ本体 | FFmpeg | 合計 |
|-----------------|-----------|--------|------|
| Windows | 5MB | 45MB | 50MB |
| macOS | 4MB | 40MB | 44MB |
| Linux | 4MB | 35MB | 39MB |

---

## 5. セキュリティ考慮

### 5.1 Tauriのセキュリティモデル

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "fs:allow-read",
    "fs:allow-write",
    "http:default",
    "shell:allow-execute"
  ],
  "windows": ["main"]
}
```

### 5.2 実装上の注意点

1. **URL検証**: 任意のURLを受け付けない（対応サイトのみ）
2. **ファイルパス検証**: ディレクトリトラバーサル防止
3. **外部通信の最小化**: 対象サイト以外への通信を制限
4. **FFmpeg入力検証**: コマンドインジェクション防止
5. **メモリ管理**: 大容量ファイルのストリーミング処理

---

## 6. テスト戦略

### 6.1 単体テスト

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_youtube_extractor_can_handle() {
        let extractor = YouTubeExtractor::new();
        assert!(extractor.can_handle("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
        assert!(extractor.can_handle("https://youtu.be/dQw4w9WgXcQ"));
        assert!(!extractor.can_handle("https://twitter.com/user/status/123"));
    }

    #[tokio::test]
    async fn test_hls_segment_parsing() {
        let downloader = HlsDownloader::new(4);
        let manifest = r#"
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment001.ts
#EXTINF:10.0,
segment002.ts
#EXT-X-ENDLIST
        "#;

        let segments = downloader.parse_segments(manifest, "https://example.com/video/").unwrap();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0], "https://example.com/video/segment001.ts");
    }
}
```

### 6.2 統合テスト

```rust
// tests/integration_test.rs
#[tokio::test]
async fn test_full_download_flow() {
    // テスト用のモックサーバーを使用
    let mock_server = MockServer::start().await;

    // テストデータの準備
    mock_server.mock_youtube_response("test_video_id").await;

    // ダウンロードフロー全体をテスト
    let result = download_video(
        &format!("{}/watch?v=test_video_id", mock_server.url()),
        &temp_dir,
    ).await;

    assert!(result.is_ok());
    assert!(temp_dir.join("test_video.mp4").exists());
}
```

---

## 7. 実装ロードマップ

### Phase 2-1: 基盤構築（1週目）
- [ ] Tauri プロジェクト初期化
- [ ] フロントエンド基本UI
- [ ] Rust バックエンド骨格
- [ ] IPC通信の確立

### Phase 2-2: コア機能（2-3週目）
- [ ] YouTube Extractor
- [ ] HTTP Downloader
- [ ] HLS Downloader
- [ ] FFmpeg Sidecar 連携

### Phase 2-3: UI/UX完成（4週目）
- [ ] ダウンロードキュー
- [ ] 進捗表示
- [ ] 設定画面
- [ ] エラーハンドリング

### Phase 2-4: 拡張（5-6週目）
- [ ] Twitter/X Extractor
- [ ] TikTok Extractor
- [ ] Vimeo Extractor
- [ ] 汎用 Extractor

### Phase 2-5: 仕上げ（7週目）
- [ ] テスト整備
- [ ] ドキュメント
- [ ] クロスプラットフォームビルド
- [ ] インストーラー作成

---

この設計書に基づいて実装を進める準備ができています。ご質問への回答をいただければ、Phase 2の実装を開始します。

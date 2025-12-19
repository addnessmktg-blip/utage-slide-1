import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface VideoFormat {
  format_id: string;
  ext: string;
  quality: string;
  url: string;
  filesize: number | null;
  has_video: boolean;
  has_audio: boolean;
}

interface VideoInfo {
  id: string;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  formats: VideoFormat[];
  site: string;
}

interface DownloadProgress {
  downloaded: number;
  total: number | null;
  percentage: number;
  speed: number;
}

type AppStatus = "idle" | "loading" | "ready" | "downloading" | "completed" | "error";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function App() {
  const [url, setUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>("");
  const [status, setStatus] = useState<AppStatus>("idle");
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);

  // Auto-analyze when URL changes from extension
  const autoAnalyze = async (newUrl: string) => {
    if (!newUrl.trim()) return;
    setUrl(newUrl);
    setStatus("loading");
    setError(null);
    setVideoInfo(null);

    try {
      const info = await invoke<VideoInfo>("get_video_info", { url: newUrl.trim() });
      setVideoInfo(info);
      const bestFormat = info.formats.find((f) => f.has_video && f.has_audio) || info.formats[0];
      if (bestFormat) {
        setSelectedFormat(bestFormat.format_id);
      }
      setStatus("ready");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  };

  useEffect(() => {
    // Listen for download progress
    const unlistenProgress = listen<[string, DownloadProgress]>("download-progress", (event) => {
      setProgress(event.payload[1]);
    });

    // Listen for download completion
    const unlistenComplete = listen<[string, string]>("download-complete", (event) => {
      setStatus("completed");
      setDownloadedPath(event.payload[1]);
      setProgress(null);
    });

    // Listen for download errors
    const unlistenError = listen<[string, string]>("download-error", (event) => {
      setStatus("error");
      setError(event.payload[1]);
      setProgress(null);
    });

    // Listen for URLs sent from browser extension
    const unlistenExtension = listen<string>("extension-download", (event) => {
      autoAnalyze(event.payload);
    });

    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenExtension.then((fn) => fn());
    };
  }, []);

  const handleAnalyze = async () => {
    if (!url.trim()) return;

    setStatus("loading");
    setError(null);
    setVideoInfo(null);

    try {
      const info = await invoke<VideoInfo>("get_video_info", { url: url.trim() });
      setVideoInfo(info);
      // Select the best format by default (first one with both video and audio)
      const bestFormat = info.formats.find((f) => f.has_video && f.has_audio) || info.formats[0];
      if (bestFormat) {
        setSelectedFormat(bestFormat.format_id);
      }
      setStatus("ready");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  };

  const handleDownload = async () => {
    if (!videoInfo || !selectedFormat) return;

    setStatus("downloading");
    setError(null);
    setProgress({ downloaded: 0, total: null, percentage: 0, speed: 0 });

    try {
      await invoke("start_download", {
        url: url.trim(),
        formatId: selectedFormat,
        outputDir: null, // Use default download directory
      });
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  };

  const handleReset = () => {
    setUrl("");
    setVideoInfo(null);
    setSelectedFormat("");
    setStatus("idle");
    setProgress(null);
    setError(null);
    setDownloadedPath(null);
  };

  const openDownloadFolder = async () => {
    try {
      await invoke("open_download_dir");
    } catch (e) {
      console.error("Failed to open folder:", e);
    }
  };

  // Filter formats to show only useful ones
  const getDisplayFormats = () => {
    if (!videoInfo) return [];
    // Prioritize formats with both video and audio
    const combined = videoInfo.formats.filter((f) => f.has_video && f.has_audio);
    const videoOnly = videoInfo.formats.filter((f) => f.has_video && !f.has_audio);
    const audioOnly = videoInfo.formats.filter((f) => !f.has_video && f.has_audio);

    // Return combined first, then video-only, limited selection
    return [...combined, ...videoOnly.slice(0, 3), ...audioOnly.slice(0, 2)];
  };

  return (
    <main className="container">
      <h1>Video Downloader</h1>

      {/* URL Input */}
      <div className="input-section">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="YouTubeやTwitterの動画URLを貼り付け"
          disabled={status === "loading" || status === "downloading"}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAnalyze();
          }}
        />
        <button
          onClick={handleAnalyze}
          disabled={!url.trim() || status === "loading" || status === "downloading"}
        >
          {status === "loading" ? "解析中..." : "解析"}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="error-message">
          <span>エラー: {error}</span>
          <button onClick={handleReset} className="reset-btn">
            リセット
          </button>
        </div>
      )}

      {/* Video Info */}
      {videoInfo && status !== "error" && (
        <div className="video-info">
          {videoInfo.thumbnail && (
            <img src={videoInfo.thumbnail} alt={videoInfo.title} className="thumbnail" />
          )}
          <div className="video-details">
            <h2>{videoInfo.title}</h2>
            <p className="meta">
              {videoInfo.site}
              {videoInfo.uploader && ` • ${videoInfo.uploader}`}
              {videoInfo.duration && ` • ${formatDuration(videoInfo.duration)}`}
            </p>

            {/* Format Selection */}
            {status === "ready" && (
              <div className="format-selection">
                <label>品質を選択:</label>
                <select
                  value={selectedFormat}
                  onChange={(e) => setSelectedFormat(e.target.value)}
                >
                  {getDisplayFormats().map((format) => (
                    <option key={format.format_id} value={format.format_id}>
                      {format.quality} ({format.ext})
                      {format.filesize && ` - ${formatBytes(format.filesize)}`}
                      {!format.has_audio && " [映像のみ]"}
                      {!format.has_video && " [音声のみ]"}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Download Progress */}
      {status === "downloading" && progress && (
        <div className="progress-section">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          <div className="progress-text">
            <span>{progress.percentage.toFixed(1)}%</span>
            <span>
              {formatBytes(progress.downloaded)}
              {progress.total && ` / ${formatBytes(progress.total)}`}
            </span>
            <span>{formatBytes(progress.speed)}/s</span>
          </div>
        </div>
      )}

      {/* Download Button */}
      {status === "ready" && (
        <button className="download-btn" onClick={handleDownload}>
          ダウンロード開始
        </button>
      )}

      {/* Completed */}
      {status === "completed" && (
        <div className="completed-section">
          <p className="success-message">ダウンロード完了！</p>
          {downloadedPath && <p className="downloaded-path">{downloadedPath}</p>}
          <div className="completed-actions">
            <button onClick={openDownloadFolder}>フォルダを開く</button>
            <button onClick={handleReset}>新しいダウンロード</button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer>
        <p>YouTube, Twitter/X, TikTok, Vimeo などに対応</p>
      </footer>
    </main>
  );
}

export default App;

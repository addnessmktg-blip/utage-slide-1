const BUTTON_CLASS = "utage-downloader-button";
const BUTTON_WRAPPER_CLASS = "utage-downloader-wrapper";
const TOAST_CLASS = "utage-downloader-toast";

function getVideoSources(video) {
  const urls = new Set();
  if (video.currentSrc) urls.add(video.currentSrc);
  if (video.src) urls.add(video.src);

  video.querySelectorAll("source").forEach((source) => {
    if (source.src) urls.add(source.src);
  });

  return Array.from(urls).filter(Boolean);
}

function pickBestSource(sources) {
  if (!sources || sources.length === 0) return null;
  const preferred = sources.find((src) => src.includes(".mp4"));
  return preferred || sources[0];
}

function ensureWrapper(video) {
  const parent = video.parentElement;
  if (!parent) return null;
  const style = window.getComputedStyle(parent);
  if (style.position === "static") {
    parent.dataset.utageDownloaderOriginalPosition = "static";
    parent.style.position = "relative";
  }
  return parent;
}

function showToast(message, variant = "info") {
  const toast = document.createElement("div");
  toast.className = `${TOAST_CLASS} ${TOAST_CLASS}-${variant}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

function createButton(video) {
  if (video.dataset.utageDownloaderAttached) return;
  const wrapper = ensureWrapper(video);
  if (!wrapper) return;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Download";
  button.className = BUTTON_CLASS;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();

    const sources = getVideoSources(video);
    const bestSource = pickBestSource(sources);
    if (!bestSource) {
      showToast("ダウンロード可能な動画URLが見つかりませんでした", "error");
      return;
    }

    const label = video.getAttribute("title") || video.getAttribute("aria-label");
    chrome.runtime.sendMessage(
      {
        type: "DOWNLOAD_VIDEO",
        url: bestSource,
        contextTitle: document.title,
        label,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          showToast(`保存に失敗しました: ${chrome.runtime.lastError.message}`, "error");
          return;
        }
        if (!response?.ok) {
          showToast(`保存に失敗しました: ${response?.error || "不明なエラー"}`, "error");
          return;
        }
        showToast("ダウンロードを開始しました", "success");
      }
    );
  });

  const wrapperDiv = document.createElement("div");
  wrapperDiv.className = BUTTON_WRAPPER_CLASS;
  wrapperDiv.appendChild(button);
  wrapper.appendChild(wrapperDiv);
  video.dataset.utageDownloaderAttached = "true";
}

function scanForVideos(root = document) {
  const videos = root.querySelectorAll("video");
  videos.forEach(createButton);
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.tagName === "VIDEO") {
        createButton(node);
      } else if (node.querySelectorAll) {
        scanForVideos(node);
      }
    });
  });
});

function init() {
  scanForVideos();
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  init();
} else {
  window.addEventListener("DOMContentLoaded", init, { once: true });
}

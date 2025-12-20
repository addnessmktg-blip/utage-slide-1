const RESERVED_CHARACTERS = /[<>:"/\\|?*]/g;

function sanitizeFilenamePart(part) {
  const trimmed = (part || "").trim();
  const sanitized = trimmed.replace(RESERVED_CHARACTERS, "_").replace(/\s+/g, " ");
  if (sanitized.length === 0) {
    return "video";
  }
  return sanitized.slice(0, 80);
}

function inferExtensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split("/").filter(Boolean).pop() || "";
    const extMatch = lastSegment.match(/\.([a-zA-Z0-9]{2,5})(?:$|[?#])/);
    if (extMatch && extMatch[1]) {
      return extMatch[1];
    }
  } catch (error) {
    // Data URLs or invalid URLs will fall back to default extension.
  }
  return "mp4";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "DOWNLOAD_VIDEO") return;

  const { url, contextTitle, label } = message;
  const sanitizedTitle = sanitizeFilenamePart(contextTitle || "video");
  const sanitizedLabel = sanitizeFilenamePart(label || "");
  const extension = inferExtensionFromUrl(url);
  const filename = sanitizedLabel
    ? `${sanitizedTitle} - ${sanitizedLabel}.${extension}`
    : `${sanitizedTitle}.${extension}`;

  chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    sendResponse({ ok: true, downloadId });
  });

  return true;
});

// Background service worker for video downloads
// Captures network requests to find authenticated video URLs

// Store captured video requests per tab
const capturedVideos = new Map(); // tabId -> array of video info
const capturedSegments = new Map(); // tabId -> Map of m3u8Url -> segments

// Video file patterns
const VIDEO_PATTERNS = [
  /\.m3u8(\?|$)/i,
  /\.ts(\?|$)/i,
  /\.mp4(\?|$)/i,
  /\.webm(\?|$)/i,
  /\.m4s(\?|$)/i,
  /\/video\//i,
  /\/media\//i,
  /\/stream\//i,
  /\/hls\//i,
  /\/playlist\//i
];

// Check if URL looks like a video
function isVideoUrl(url) {
  return VIDEO_PATTERNS.some(pattern => pattern.test(url));
}

// Get video type from URL
function getVideoType(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
  if (/\.ts(\?|$)/i.test(url)) return 'segment';
  if (/\.mp4(\?|$)/i.test(url)) return 'mp4';
  if (/\.webm(\?|$)/i.test(url)) return 'webm';
  if (/\.m4s(\?|$)/i.test(url)) return 'dash-segment';
  return 'video';
}

// Initialize storage for a tab
function initTab(tabId) {
  if (!capturedVideos.has(tabId)) {
    capturedVideos.set(tabId, []);
  }
  if (!capturedSegments.has(tabId)) {
    capturedSegments.set(tabId, new Map());
  }
}

// Add a captured video URL
function addCapturedVideo(tabId, url, type, initiator) {
  initTab(tabId);
  const videos = capturedVideos.get(tabId);

  // Check if already captured
  if (videos.some(v => v.url === url)) {
    return;
  }

  videos.push({
    url,
    type,
    initiator,
    timestamp: Date.now()
  });

  console.log(`Captured ${type}:`, url.substring(0, 100));
}

// Add a segment to an HLS stream
function addSegment(tabId, m3u8Url, segmentUrl) {
  initTab(tabId);
  const segments = capturedSegments.get(tabId);

  if (!segments.has(m3u8Url)) {
    segments.set(m3u8Url, new Set());
  }

  segments.get(m3u8Url).add(segmentUrl);
}

// Listen for network requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { url, tabId, type, initiator } = details;

    // Skip extension requests
    if (tabId < 0) return;

    // Check if this is a video request
    if (isVideoUrl(url)) {
      const videoType = getVideoType(url);

      if (videoType === 'segment' || videoType === 'dash-segment') {
        // This is a segment, try to find parent m3u8
        const videos = capturedVideos.get(tabId) || [];
        const hlsVideos = videos.filter(v => v.type === 'hls');

        if (hlsVideos.length > 0) {
          // Add to the most recent HLS stream
          addSegment(tabId, hlsVideos[hlsVideos.length - 1].url, url);
        }

        // Also add as standalone in case we need it
        addCapturedVideo(tabId, url, videoType, initiator);
      } else {
        addCapturedVideo(tabId, url, videoType, initiator);
      }
    }
  },
  { urls: ["<all_urls>"] }
);

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedVideos.delete(tabId);
  capturedSegments.delete(tabId);
});

// Clean up when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    // Clear captured videos when navigating to a new page
    capturedVideos.set(tabId, []);
    capturedSegments.set(tabId, new Map());
  }
});

// Download function using captured segments
async function downloadCapturedVideo(url, type, tabId) {
  console.log('Downloading:', url, type);

  if (type === 'hls') {
    // Get captured segments for this HLS stream
    const segments = capturedSegments.get(tabId);
    let segmentUrls = [];

    if (segments && segments.has(url)) {
      segmentUrls = Array.from(segments.get(url));
    }

    if (segmentUrls.length > 0) {
      console.log(`Found ${segmentUrls.length} captured segments`);
      return downloadSegments(segmentUrls);
    } else {
      // Try to fetch the m3u8 and download normally
      // This might still fail without auth, but worth trying
      return downloadHlsStream(url);
    }
  } else if (type === 'segment') {
    // Single segment - just download it
    return downloadDirect(url);
  } else {
    // Direct download
    return downloadDirect(url);
  }
}

// Download captured segments
async function downloadSegments(segmentUrls) {
  console.log('Downloading', segmentUrls.length, 'segments');

  const chunks = [];

  for (let i = 0; i < segmentUrls.length; i++) {
    try {
      const response = await fetch(segmentUrls[i]);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        chunks.push(new Uint8Array(buffer));
        console.log(`Downloaded segment ${i + 1}/${segmentUrls.length}`);
      }
    } catch (e) {
      console.error(`Failed to download segment ${i}:`, e);
    }
  }

  if (chunks.length === 0) {
    throw new Error('No segments could be downloaded');
  }

  // Combine chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

// Try to download HLS stream (fallback)
async function downloadHlsStream(url) {
  const response = await fetch(url);
  const text = await response.text();

  if (text.includes('<!') || text.includes('<html')) {
    throw new Error('認証エラー');
  }

  const lines = text.split('\n');
  const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

  // Check for master playlist
  const m3u8Lines = lines.filter(l => l.trim().endsWith('.m3u8'));
  if (m3u8Lines.length > 0) {
    let streamUrl = m3u8Lines[m3u8Lines.length - 1].trim();
    if (!streamUrl.startsWith('http')) {
      streamUrl = baseUrl + streamUrl;
    }
    return downloadHlsStream(streamUrl);
  }

  // Get segments
  const segments = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      let segmentUrl = trimmed;
      if (!segmentUrl.startsWith('http')) {
        segmentUrl = baseUrl + segmentUrl;
      }
      segments.push(segmentUrl);
    }
  }

  return downloadSegments(segments);
}

// Direct download
async function downloadDirect(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getCapturedVideos') {
    const tabId = request.tabId;
    const videos = capturedVideos.get(tabId) || [];
    const segments = capturedSegments.get(tabId) || new Map();

    // Add segment count to HLS videos
    const videosWithInfo = videos.map(v => {
      if (v.type === 'hls' && segments.has(v.url)) {
        return { ...v, segmentCount: segments.get(v.url).size };
      }
      return v;
    });

    // Filter to show useful videos (HLS and direct videos, not individual segments)
    const filteredVideos = videosWithInfo.filter(v =>
      v.type === 'hls' || v.type === 'mp4' || v.type === 'webm' || v.type === 'video'
    );

    sendResponse({ videos: filteredVideos });
    return true;
  }

  if (request.action === 'download') {
    const { url, type, tabId } = request;

    (async () => {
      try {
        const data = await downloadCapturedVideo(url, type, tabId);

        // Convert to base64
        const blob = new Blob([data], {
          type: type === 'hls' || type === 'segment' ? 'video/mp2t' : 'video/mp4'
        });

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          sendResponse({ success: true, data: base64 });
        };
        reader.readAsDataURL(blob);

      } catch (err) {
        console.error('Download error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }
});

console.log('Video Downloader v3 - Network capture mode loaded');

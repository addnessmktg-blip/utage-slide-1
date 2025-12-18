// Background service worker for video downloads
// Captures m3u8 URLs and parses them to get ALL segments

// Store captured video requests per tab
const capturedVideos = new Map(); // tabId -> array of video info

// Video file patterns
const VIDEO_PATTERNS = [
  /\.m3u8(\?|$)/i,
  /\.mp4(\?|$)/i,
  /\.webm(\?|$)/i
];

// Check if URL looks like a video
function isVideoUrl(url) {
  return VIDEO_PATTERNS.some(pattern => pattern.test(url));
}

// Get video type from URL
function getVideoType(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
  if (/\.mp4(\?|$)/i.test(url)) return 'mp4';
  if (/\.webm(\?|$)/i.test(url)) return 'webm';
  return 'video';
}

// Initialize storage for a tab
function initTab(tabId) {
  if (!capturedVideos.has(tabId)) {
    capturedVideos.set(tabId, []);
  }
}

// Parse m3u8 and get ALL segment URLs
async function parseM3u8ForSegments(url) {
  try {
    console.log('Parsing m3u8:', url);
    const response = await fetch(url);
    const text = await response.text();

    if (text.includes('<!') || text.includes('<html')) {
      console.log('Got HTML instead of m3u8');
      return { segments: [], error: 'auth' };
    }

    const lines = text.split('\n');
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

    // Check if this is a master playlist (contains other m3u8)
    const m3u8Lines = lines.filter(l => l.trim().endsWith('.m3u8') && !l.startsWith('#'));
    if (m3u8Lines.length > 0) {
      // Get the highest quality (usually last one)
      let streamUrl = m3u8Lines[m3u8Lines.length - 1].trim();
      if (!streamUrl.startsWith('http')) {
        streamUrl = baseUrl + streamUrl;
      }
      console.log('Found sub-playlist:', streamUrl);
      return parseM3u8ForSegments(streamUrl);
    }

    // Parse segment URLs
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

    console.log(`Found ${segments.length} segments in playlist`);
    return { segments, error: null };
  } catch (e) {
    console.error('Error parsing m3u8:', e);
    return { segments: [], error: e.message };
  }
}

// Add a captured video URL
async function addCapturedVideo(tabId, url, type, initiator) {
  initTab(tabId);
  const videos = capturedVideos.get(tabId);

  // Check if already captured
  if (videos.some(v => v.url === url)) {
    return;
  }

  const videoInfo = {
    url,
    type,
    initiator,
    timestamp: Date.now(),
    segments: [],
    segmentCount: 0,
    status: 'captured'
  };

  // If it's HLS, immediately parse to get all segments
  if (type === 'hls') {
    videoInfo.status = 'parsing';
    const { segments, error } = await parseM3u8ForSegments(url);

    if (segments.length > 0) {
      videoInfo.segments = segments;
      videoInfo.segmentCount = segments.length;
      videoInfo.status = 'ready';
      console.log(`HLS ready: ${segments.length} segments`);
    } else {
      videoInfo.status = error === 'auth' ? 'auth_error' : 'parse_error';
      console.log('HLS parse failed:', error);
    }
  }

  videos.push(videoInfo);
  console.log(`Captured ${type}:`, url.substring(0, 100));
}

// Listen for network requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { url, tabId, initiator } = details;

    // Skip extension requests
    if (tabId < 0) return;

    // Check if this is a video request
    if (isVideoUrl(url)) {
      const videoType = getVideoType(url);
      // Don't block, just capture async
      addCapturedVideo(tabId, url, videoType, initiator);
    }
  },
  { urls: ["<all_urls>"] }
);

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedVideos.delete(tabId);
});

// Clean up when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    capturedVideos.set(tabId, []);
  }
});

// Download segments
async function downloadSegments(segments, onProgress) {
  console.log('Downloading', segments.length, 'segments');

  const chunks = [];
  let failed = 0;

  for (let i = 0; i < segments.length; i++) {
    try {
      if (onProgress) {
        onProgress(i + 1, segments.length);
      }

      const response = await fetch(segments[i]);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        chunks.push(new Uint8Array(buffer));
      } else {
        failed++;
        console.log(`Segment ${i + 1} failed: ${response.status}`);
      }
    } catch (e) {
      failed++;
      console.error(`Segment ${i + 1} error:`, e.message);
    }
  }

  console.log(`Downloaded ${chunks.length}/${segments.length} segments (${failed} failed)`);

  if (chunks.length === 0) {
    throw new Error('セグメントをダウンロードできませんでした');
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

    // Filter to show useful videos
    const filteredVideos = videos.filter(v =>
      v.type === 'hls' || v.type === 'mp4' || v.type === 'webm' || v.type === 'video'
    );

    sendResponse({ videos: filteredVideos });
    return true;
  }

  if (request.action === 'download') {
    const { url, type, tabId } = request;

    (async () => {
      try {
        let data;

        if (type === 'hls') {
          // Find the video info with segments
          const videos = capturedVideos.get(tabId) || [];
          const videoInfo = videos.find(v => v.url === url);

          if (videoInfo && videoInfo.segments && videoInfo.segments.length > 0) {
            console.log(`Using ${videoInfo.segments.length} pre-parsed segments`);
            data = await downloadSegments(videoInfo.segments);
          } else {
            // Try to parse again
            console.log('Re-parsing m3u8...');
            const { segments, error } = await parseM3u8ForSegments(url);
            if (segments.length > 0) {
              data = await downloadSegments(segments);
            } else {
              throw new Error(error || 'セグメントが見つかりません');
            }
          }
        } else {
          data = await downloadDirect(url);
        }

        // Convert to base64
        const blob = new Blob([data], {
          type: type === 'hls' ? 'video/mp2t' : 'video/mp4'
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

  // Re-parse m3u8 on demand
  if (request.action === 'reparse') {
    const { url, tabId } = request;

    (async () => {
      const { segments, error } = await parseM3u8ForSegments(url);

      // Update stored video info
      const videos = capturedVideos.get(tabId) || [];
      const videoInfo = videos.find(v => v.url === url);
      if (videoInfo) {
        videoInfo.segments = segments;
        videoInfo.segmentCount = segments.length;
        videoInfo.status = segments.length > 0 ? 'ready' : 'error';
      }

      sendResponse({ segments: segments.length, error });
    })();

    return true;
  }
});

console.log('Video Downloader v3.1 - Auto-parse m3u8 mode');

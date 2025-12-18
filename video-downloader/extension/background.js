// Background service worker for video downloads
// Captures m3u8 URLs and parses them to get ALL segments

// Store captured video requests per tab
const capturedVideos = new Map(); // tabId -> array of video info

// Pending downloads map: blob URL -> filename
const pendingDownloads = new Map();

// Force filename for blob URL downloads
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (downloadItem.url.startsWith('blob:')) {
    const pendingFilename = pendingDownloads.get(downloadItem.url);
    if (pendingFilename) {
      console.log('[VIDEO HACKER] Setting filename:', pendingFilename);
      suggest({ filename: pendingFilename });
      pendingDownloads.delete(downloadItem.url);
      return true;
    }
  }
  suggest();
  return true;
});

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

// Parse m3u8 and get ALL segment URLs with encryption info
async function parseM3u8ForSegments(url) {
  try {
    console.log('Parsing m3u8:', url);
    const response = await fetch(url);
    const text = await response.text();

    if (text.includes('<!') || text.includes('<html')) {
      console.log('Got HTML instead of m3u8');
      return { segments: [], error: 'auth', encrypted: false, keyUrl: null };
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

    // Check for encryption
    let encrypted = false;
    let keyUrl = null;
    let keyIV = null;

    for (const line of lines) {
      if (line.startsWith('#EXT-X-KEY')) {
        encrypted = true;
        // Parse key URL: #EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x...
        const uriMatch = line.match(/URI="([^"]+)"/);
        const ivMatch = line.match(/IV=0x([0-9a-fA-F]+)/);

        if (uriMatch) {
          keyUrl = uriMatch[1];
          if (!keyUrl.startsWith('http')) {
            keyUrl = baseUrl + keyUrl;
          }
        }
        if (ivMatch) {
          keyIV = ivMatch[1];
        }
        console.log('Found encryption:', { keyUrl, keyIV: keyIV ? 'present' : 'none' });
      }
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

    console.log(`Found ${segments.length} segments in playlist (encrypted: ${encrypted})`);
    return { segments, error: null, encrypted, keyUrl, keyIV };
  } catch (e) {
    console.error('Error parsing m3u8:', e);
    return { segments: [], error: e.message, encrypted: false, keyUrl: null };
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
    status: 'captured',
    encrypted: false,
    keyUrl: null,
    keyIV: null
  };

  // If it's HLS, immediately parse to get all segments
  if (type === 'hls') {
    videoInfo.status = 'parsing';
    const { segments, error, encrypted, keyUrl, keyIV } = await parseM3u8ForSegments(url);

    if (segments.length > 0) {
      videoInfo.segments = segments;
      videoInfo.segmentCount = segments.length;
      videoInfo.encrypted = encrypted;
      videoInfo.keyUrl = keyUrl;
      videoInfo.keyIV = keyIV;
      videoInfo.status = 'ready';
      console.log(`HLS ready: ${segments.length} segments, encrypted: ${encrypted}`);
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

// Clean up when tab navigates to a completely different page
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only clear if navigating to a completely different origin
  if (changeInfo.status === 'loading' && changeInfo.url) {
    try {
      const newUrl = new URL(changeInfo.url);
      const videos = capturedVideos.get(tabId) || [];
      if (videos.length > 0) {
        const oldUrl = new URL(videos[0].initiator || videos[0].url);
        // Only clear if origin changed
        if (newUrl.origin !== oldUrl.origin) {
          console.log('Clearing videos - navigated to different origin');
          capturedVideos.set(tabId, []);
        }
      }
    } catch (e) {
      // If URL parsing fails, don't clear
    }
  }
});

// Fetch encryption key
async function fetchEncryptionKey(keyUrl) {
  try {
    console.log('Fetching encryption key from:', keyUrl);
    const response = await fetch(keyUrl);
    if (!response.ok) {
      throw new Error(`Key fetch failed: ${response.status}`);
    }
    const keyData = await response.arrayBuffer();
    console.log('Got encryption key, length:', keyData.byteLength);
    return new Uint8Array(keyData);
  } catch (e) {
    console.error('Failed to fetch key:', e);
    throw e;
  }
}

// Decrypt a segment using AES-128-CBC
async function decryptSegment(encryptedData, key, iv) {
  try {
    // Import the key for AES-CBC decryption
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-CBC' },
      false,
      ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: iv },
      cryptoKey,
      encryptedData
    );

    return new Uint8Array(decrypted);
  } catch (e) {
    console.error('Decryption failed:', e);
    throw e;
  }
}

// Generate IV from segment index (default HLS behavior)
function generateIV(index, explicitIV) {
  if (explicitIV) {
    // Parse hex IV string
    const iv = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      iv[i] = parseInt(explicitIV.substr(i * 2, 2), 16);
    }
    return iv;
  }
  // Default: use segment index as IV
  const iv = new Uint8Array(16);
  const view = new DataView(iv.buffer);
  view.setUint32(12, index, false); // Big-endian
  return iv;
}

// Download segments (with optional decryption)
async function downloadSegments(segments, onProgress, encryptionInfo = null) {
  console.log('Downloading', segments.length, 'segments');

  let key = null;
  if (encryptionInfo && encryptionInfo.keyUrl) {
    console.log('Stream is encrypted, fetching key...');
    key = await fetchEncryptionKey(encryptionInfo.keyUrl);
  }

  const chunks = [];
  let failed = 0;

  for (let i = 0; i < segments.length; i++) {
    try {
      if (onProgress) {
        onProgress(i + 1, segments.length);
      }

      const response = await fetch(segments[i]);
      if (response.ok) {
        let buffer = await response.arrayBuffer();
        let data = new Uint8Array(buffer);

        // Check if this looks like video data (TS sync byte is 0x47)
        if (data.length > 0 && data[0] !== 0x47 && !key) {
          console.log(`Segment ${i + 1}: First byte is ${data[0].toString(16)}, not 0x47 (may be encrypted)`);
        }

        // Decrypt if we have a key
        if (key) {
          const iv = generateIV(i, encryptionInfo.keyIV);
          try {
            data = await decryptSegment(buffer, key, iv);
            // Verify decryption worked (check for TS sync byte)
            if (data.length > 0 && data[0] === 0x47) {
              console.log(`Segment ${i + 1}: Decrypted successfully`);
            } else {
              console.log(`Segment ${i + 1}: Decrypted but first byte is ${data[0].toString(16)}`);
            }
          } catch (e) {
            console.error(`Segment ${i + 1}: Decryption failed, using raw data`);
            data = new Uint8Array(buffer);
          }
        }

        chunks.push(data);
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
  // Register pending download filename
  if (request.action === 'registerDownload') {
    const { blobUrl, filename } = request;
    pendingDownloads.set(blobUrl, filename);
    console.log('[VIDEO HACKER] Registered pending download:', filename);
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'getCapturedVideos') {
    const tabId = request.tabId;
    const videos = capturedVideos.get(tabId) || [];

    console.log(`getCapturedVideos for tab ${tabId}: found ${videos.length} videos`);
    console.log('All tabs with videos:', Array.from(capturedVideos.keys()));

    // Filter to show useful videos
    const filteredVideos = videos.filter(v =>
      v.type === 'hls' || v.type === 'mp4' || v.type === 'webm' || v.type === 'video'
    );

    console.log(`Returning ${filteredVideos.length} filtered videos`);
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
            const encryptionInfo = videoInfo.encrypted ? {
              keyUrl: videoInfo.keyUrl,
              keyIV: videoInfo.keyIV
            } : null;
            if (encryptionInfo) {
              console.log('Stream is encrypted, will decrypt segments');
            }
            data = await downloadSegments(videoInfo.segments, null, encryptionInfo);
          } else {
            // Try to parse again
            console.log('Re-parsing m3u8...');
            const { segments, error, encrypted, keyUrl, keyIV } = await parseM3u8ForSegments(url);
            if (segments.length > 0) {
              const encryptionInfo = encrypted ? { keyUrl, keyIV } : null;
              data = await downloadSegments(segments, null, encryptionInfo);
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

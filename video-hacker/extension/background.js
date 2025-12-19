// Background service worker for video downloads
// Captures m3u8 URLs and parses them to get ALL segments

// Store captured video requests per tab
const capturedVideos = new Map(); // tabId -> array of video info

// Pending downloads map: blob URL -> filename
const pendingDownloads = new Map();

// IndexedDB for temporary video data storage
const DB_NAME = 'VideoHackerDB';
const STORE_NAME = 'videoData';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

async function storeVideoData(id, data, mimeType) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({ id, data, mimeType, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getVideoData(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteVideoData(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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
// SIMPLE VERSION - works with YouTube/googlevideo
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

    // First, check if this playlist has actual video segments (not just references to other playlists)
    // Segments are non-comment lines that don't end in .m3u8
    const segmentLines = lines.filter(l => {
      const trimmed = l.trim();
      return trimmed && !trimmed.startsWith('#') && !trimmed.endsWith('.m3u8');
    });

    // If we have segments, parse them directly (don't recurse to audio playlist)
    if (segmentLines.length > 0) {
      console.log(`Found ${segmentLines.length} segment URLs directly`);
      // Continue to segment parsing below
    } else {
      // No segments found, check for sub-playlists (master playlist)
      const m3u8Lines = lines.filter(l => l.trim().endsWith('.m3u8') && !l.startsWith('#'));
      if (m3u8Lines.length > 0) {
        // For YouTube: pick the FIRST one (highest quality video)
        // YouTube lists video qualities from highest to lowest
        let streamUrl = m3u8Lines[0].trim();
        if (!streamUrl.startsWith('http')) {
          streamUrl = baseUrl + streamUrl;
        }
        console.log('Found sub-playlist (picking first/highest quality):', streamUrl);
        return parseM3u8ForSegments(streamUrl);
      }
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
async function downloadSegments(segments, onProgress, encryptionInfo = null, progressCallback = null) {
  console.log('Downloading', segments.length, 'segments');

  let key = null;
  if (encryptionInfo && encryptionInfo.keyUrl) {
    console.log('Stream is encrypted, fetching key...');
    key = await fetchEncryptionKey(encryptionInfo.keyUrl);
  }

  const chunks = [];
  let failed = 0;
  let totalBytes = 0;

  // Download in batches to avoid memory issues
  const BATCH_SIZE = 10;

  for (let i = 0; i < segments.length; i++) {
    try {
      // Report progress
      if (progressCallback) {
        progressCallback(i + 1, segments.length);
      }

      const response = await fetch(segments[i]);
      if (response.ok) {
        let buffer = await response.arrayBuffer();
        let data = new Uint8Array(buffer);

        // Decrypt if we have a key
        if (key) {
          const iv = generateIV(i, encryptionInfo.keyIV);
          try {
            data = await decryptSegment(buffer, key, iv);
            if (i % 50 === 0) {
              console.log(`Segment ${i + 1}/${segments.length}: Decrypted, size: ${data.length}`);
            }
          } catch (e) {
            console.error(`Segment ${i + 1}: Decryption failed, using raw data`);
            data = new Uint8Array(buffer);
          }
        }

        totalBytes += data.length;
        chunks.push(data);

        // Log progress every 50 segments
        if (i % 50 === 0) {
          console.log(`Progress: ${i + 1}/${segments.length} segments, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
        }
      } else {
        failed++;
        console.log(`Segment ${i + 1} failed: ${response.status}`);
      }
    } catch (e) {
      failed++;
      console.error(`Segment ${i + 1} error:`, e.message);
    }

    // Small delay every batch to prevent overwhelming
    if (i > 0 && i % BATCH_SIZE === 0) {
      await new Promise(r => setTimeout(r, 10));
    }
  }

  console.log(`Downloaded ${chunks.length}/${segments.length} segments (${failed} failed)`);

  if (chunks.length === 0) {
    throw new Error('セグメントをダウンロードできませんでした');
  }

  // Combine chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  console.log(`Total size: ${(totalLength / 1024 / 1024).toFixed(2)} MB`);

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

    // Filter to show useful videos
    const filteredVideos = videos.filter(v =>
      v.type === 'hls' || v.type === 'mp4' || v.type === 'webm' || v.type === 'video'
    );

    sendResponse({ videos: filteredVideos });
    return true;
  }

  if (request.action === 'download') {
    const { url, type, tabId, filename } = request;

    (async () => {
      try {
        let data;

        // Progress callback - send updates to popup
        const progressCallback = (current, total) => {
          const percent = Math.round((current / total) * 100);
          chrome.runtime.sendMessage({
            action: 'downloadProgress',
            current,
            total,
            percent
          }).catch(() => {}); // Ignore errors if popup is closed
        };

        if (type === 'hls') {
          // ALWAYS re-parse m3u8 to get fresh segment URLs (they expire!)
          console.log('Parsing m3u8 for fresh segment URLs...');
          const { segments, error, encrypted, keyUrl, keyIV } = await parseM3u8ForSegments(url);

          if (segments.length > 0) {
            console.log(`Got ${segments.length} fresh segments`);
            const encryptionInfo = encrypted ? { keyUrl, keyIV } : null;
            if (encryptionInfo) {
              console.log('Stream is encrypted, will decrypt segments');
            }
            data = await downloadSegments(segments, null, encryptionInfo, progressCallback);
          } else {
            throw new Error(error || 'セグメントが見つかりません');
          }
        } else {
          data = await downloadDirect(url);
        }

        console.log('Download complete, storing in IndexedDB...');
        console.log(`Data size: ${(data.length / 1024 / 1024).toFixed(2)} MB`);

        // Store in IndexedDB (avoids message size limits)
        const dataId = 'video_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const mimeType = type === 'hls' ? 'video/mp2t' : 'video/mp4';

        // Store ArrayBuffer directly (NOT Array.from which fails for large data)
        await storeVideoData(dataId, data.buffer, mimeType);
        console.log('Stored in IndexedDB with ID:', dataId);

        // Send just the reference ID to popup
        sendResponse({
          success: true,
          dataId: dataId,
          mimeType: mimeType,
          size: data.length
        });

      } catch (err) {
        console.error('Download error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }

  // Retrieve video data from IndexedDB
  if (request.action === 'getVideoData') {
    const { dataId } = request;

    (async () => {
      try {
        const record = await getVideoData(dataId);
        if (record) {
          // Delete after retrieval to clean up
          await deleteVideoData(dataId);
          sendResponse({
            success: true,
            data: record.data,
            mimeType: record.mimeType
          });
        } else {
          sendResponse({ success: false, error: 'Data not found' });
        }
      } catch (err) {
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

console.log('Video Downloader v4.6 - Fixed: parse segments directly, skip audio playlist');

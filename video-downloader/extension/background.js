// Background service worker for video downloads
// This bypasses CORS restrictions

// Parse m3u8 playlist
async function parseM3u8(url) {
  const response = await fetch(url);
  const text = await response.text();

  // Check if it's HTML (error page)
  if (text.trim().startsWith('<!') || text.trim().startsWith('<html')) {
    throw new Error('認証エラー: ページにアクセスできません');
  }

  const lines = text.split('\n');
  const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

  // Check if this is a master playlist
  const m3u8Lines = lines.filter(l => l.trim().endsWith('.m3u8'));
  if (m3u8Lines.length > 0) {
    let streamUrl = m3u8Lines[m3u8Lines.length - 1].trim();
    if (!streamUrl.startsWith('http')) {
      streamUrl = baseUrl + streamUrl;
    }
    return parseM3u8(streamUrl);
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

  return segments;
}

// Download HLS stream
async function downloadHls(url, sendProgress) {
  sendProgress({ status: 'parsing', message: 'Parsing playlist...' });

  const segments = await parseM3u8(url);

  if (segments.length === 0) {
    throw new Error('セグメントが見つかりません');
  }

  sendProgress({ status: 'downloading', message: `Found ${segments.length} segments`, total: segments.length });

  // Download all segments
  const chunks = [];
  for (let i = 0; i < segments.length; i++) {
    sendProgress({ 
      status: 'downloading', 
      message: `Downloading ${i + 1}/${segments.length}...`,
      current: i + 1,
      total: segments.length,
      percent: Math.floor((i / segments.length) * 90)
    });

    const response = await fetch(segments[i]);
    if (!response.ok) {
      throw new Error(`Segment ${i + 1} failed: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    chunks.push(new Uint8Array(buffer));
  }

  sendProgress({ status: 'combining', message: 'Combining segments...', percent: 92 });

  // Combine all chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

// Download MP4/direct file
async function downloadDirect(url, sendProgress) {
  sendProgress({ status: 'downloading', message: 'Downloading...', percent: 10 });

  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error('認証エラー: ログインが必要です');
  }

  const buffer = await response.arrayBuffer();
  sendProgress({ status: 'complete', message: 'Download complete', percent: 100 });

  return new Uint8Array(buffer);
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'download') {
    const { url, type, filename } = request;

    // Use async handling
    (async () => {
      try {
        let data;
        const sendProgress = (progress) => {
          // Can't send progress updates in MV3 service worker easily
          // but we can log for debugging
          console.log('Progress:', progress);
        };

        if (type === 'hls' || url.includes('.m3u8')) {
          data = await downloadHls(url, sendProgress);
        } else {
          data = await downloadDirect(url, sendProgress);
        }

        // Create blob URL and download
        const blob = new Blob([data], { 
          type: type === 'hls' || url.includes('.m3u8') ? 'video/mp2t' : 'video/mp4' 
        });
        
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          sendResponse({ success: true, data: base64 });
        };
        reader.readAsDataURL(blob);

      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // Keep channel open for async response
  }
});

console.log('Video Downloader background script loaded');

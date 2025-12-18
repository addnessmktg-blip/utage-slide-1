// Background service worker for video downloads
// This bypasses CORS restrictions and includes cookies for authentication

let pageUrl = ''; // Store the page URL for referer

// Get cookies for multiple domains
async function getAllRelevantCookies(videoUrl, refererUrl) {
  try {
    const allCookies = [];
    const domains = new Set();

    // Add video domain
    const videoUrlObj = new URL(videoUrl);
    domains.add(videoUrlObj.hostname);

    // Add base domain of video URL
    const videoDomainParts = videoUrlObj.hostname.split('.');
    if (videoDomainParts.length > 2) {
      domains.add(videoDomainParts.slice(-2).join('.'));
    }

    // Add referer domain if provided
    if (refererUrl) {
      try {
        const refererUrlObj = new URL(refererUrl);
        domains.add(refererUrlObj.hostname);
        const refererDomainParts = refererUrlObj.hostname.split('.');
        if (refererDomainParts.length > 2) {
          domains.add(refererDomainParts.slice(-2).join('.'));
        }
      } catch (e) {}
    }

    // Get cookies from all domains
    for (const domain of domains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain });
        allCookies.push(...cookies);
      } catch (e) {}
    }

    // Also get all cookies (for session cookies that might not have domain set properly)
    try {
      const allStoreCookies = await chrome.cookies.getAll({});
      allCookies.push(...allStoreCookies);
    } catch (e) {}

    // Deduplicate by name
    const seen = new Set();
    const uniqueCookies = allCookies.filter(c => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });

    return uniqueCookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch (e) {
    console.error('Error getting cookies:', e);
    return '';
  }
}

// Fetch with cookies and proper headers
async function fetchWithAuth(url, refererUrl) {
  const cookieHeader = await getAllRelevantCookies(url, refererUrl);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
  };

  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  // Add Referer and Origin to make it look like a request from the page
  if (refererUrl) {
    headers['Referer'] = refererUrl;
    try {
      const refererUrlObj = new URL(refererUrl);
      headers['Origin'] = refererUrlObj.origin;
    } catch (e) {}
  }

  console.log('Fetching:', url);
  console.log('Headers:', headers);

  return fetch(url, {
    headers,
    credentials: 'include',
    mode: 'cors'
  });
}

// Parse m3u8 playlist
async function parseM3u8(url, refererUrl) {
  const response = await fetchWithAuth(url, refererUrl);
  const text = await response.text();

  console.log('M3u8 response:', text.substring(0, 500));

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
    return parseM3u8(streamUrl, refererUrl);
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
async function downloadHls(url, refererUrl, sendProgress) {
  sendProgress({ status: 'parsing', message: 'Parsing playlist...' });

  const segments = await parseM3u8(url, refererUrl);

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

    const response = await fetchWithAuth(segments[i], refererUrl);
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
async function downloadDirect(url, refererUrl, sendProgress) {
  sendProgress({ status: 'downloading', message: 'Downloading...', percent: 10 });

  const response = await fetchWithAuth(url, refererUrl);

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
    const { url, type, filename, referer } = request;

    // Use async handling
    (async () => {
      try {
        let data;
        const sendProgress = (progress) => {
          console.log('Progress:', progress);
        };

        if (type === 'hls' || url.includes('.m3u8')) {
          data = await downloadHls(url, referer, sendProgress);
        } else {
          data = await downloadDirect(url, referer, sendProgress);
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
        console.error('Download error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true; // Keep channel open for async response
  }
});

console.log('Video Downloader background script loaded');

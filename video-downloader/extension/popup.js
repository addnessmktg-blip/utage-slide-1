// Video detection function to be injected into the page
function detectVideos() {
  const videos = [];

  // 1. Find HTML5 video elements
  document.querySelectorAll('video').forEach((video) => {
    if (video.src) {
      videos.push({
        type: video.src.includes('.m3u8') ? 'hls' : 'video',
        url: video.src,
        source: 'video element'
      });
    }
    video.querySelectorAll('source').forEach(source => {
      if (source.src) {
        videos.push({
          type: source.src.includes('.m3u8') ? 'hls' : 'video',
          url: source.src,
          source: 'source element'
        });
      }
    });
  });

  // 2. Find iframes (video embeds)
  document.querySelectorAll('iframe').forEach((iframe) => {
    const src = iframe.src;
    if (src) {
      if (src.includes('youtube') || src.includes('youtu.be')) {
        videos.push({ type: 'youtube', url: src, source: 'iframe' });
      } else if (src.includes('vimeo')) {
        videos.push({ type: 'vimeo', url: src, source: 'iframe' });
      } else if (src.includes('player') || src.includes('video') || src.includes('embed')) {
        videos.push({ type: 'embed', url: src, source: 'iframe' });
      }
    }
  });

  // 3. Search for video URLs in scripts
  const scriptContent = Array.from(document.querySelectorAll('script'))
    .map(s => s.textContent || '')
    .join('\n');

  // Look for mp4 URLs
  const mp4Regex = /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi;
  const mp4Matches = scriptContent.match(mp4Regex) || [];
  mp4Matches.forEach(url => {
    const cleanUrl = url.replace(/["'\\]/g, '');
    if (!videos.some(v => v.url === cleanUrl)) {
      videos.push({ type: 'mp4', url: cleanUrl, source: 'script' });
    }
  });

  // Look for m3u8 (HLS) URLs
  const m3u8Regex = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi;
  const m3u8Matches = scriptContent.match(m3u8Regex) || [];
  m3u8Matches.forEach(url => {
    const cleanUrl = url.replace(/["'\\]/g, '');
    if (!videos.some(v => v.url === cleanUrl)) {
      videos.push({ type: 'hls', url: cleanUrl, source: 'script' });
    }
  });

  // 4. Search in data attributes
  document.querySelectorAll('[data-src], [data-video], [data-url], [data-video-url]').forEach(el => {
    const url = el.dataset.src || el.dataset.video || el.dataset.url || el.dataset.videoUrl;
    if (url && (url.includes('.mp4') || url.includes('.m3u8'))) {
      if (!videos.some(v => v.url === url)) {
        const type = url.includes('.m3u8') ? 'hls' : 'mp4';
        videos.push({ type, url, source: 'data attribute' });
      }
    }
  });

  // Deduplicate by URL
  const seen = new Set();
  return videos.filter(v => {
    if (seen.has(v.url)) return false;
    seen.add(v.url);
    return true;
  });
}

let foundVideos = [];
let currentTab = null;

// Progress UI helpers
function showProgress(text, percent) {
  const container = document.getElementById('progress');
  const fill = document.getElementById('progressFill');
  const textEl = document.getElementById('progressText');

  container.classList.add('active');
  fill.style.width = percent + '%';
  textEl.textContent = text;
}

function hideProgress() {
  document.getElementById('progress').classList.remove('active');
}

// Function to be injected into page for HLS download
async function downloadHlsInPage(url) {
  // Parse m3u8 playlist
  async function parseM3u8(url) {
    const response = await fetch(url, { credentials: 'include' });
    const text = await response.text();

    // Check if it's HTML (error page)
    if (text.trim().startsWith('<!') || text.trim().startsWith('<html')) {
      throw new Error('認証エラー: ログインが必要です');
    }

    const lines = text.split('\n');
    const segments = [];
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

  try {
    const segments = await parseM3u8(url);

    if (segments.length === 0) {
      throw new Error('セグメントが見つかりません');
    }

    // Download all segments
    const chunks = [];
    for (let i = 0; i < segments.length; i++) {
      const response = await fetch(segments[i], { credentials: 'include' });
      const buffer = await response.arrayBuffer();
      chunks.push(new Uint8Array(buffer));

      // Update progress via console (we'll read this)
      console.log(`__DOWNLOAD_PROGRESS__:${i + 1}/${segments.length}`);
    }

    // Combine all chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    // Convert to base64 for transfer
    let binary = '';
    const len = combined.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(combined[i]);
    }
    return { success: true, data: btoa(binary), segments: segments.length };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Function to be injected for MP4 download
async function downloadMp4InPage(url) {
  try {
    const response = await fetch(url, { credentials: 'include' });
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      throw new Error('認証エラー: ログインが必要です');
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    // Convert to base64
    let binary = '';
    const len = data.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(data[i]);
    }
    return { success: true, data: btoa(binary) };

  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Download video by injecting into page context
async function downloadVideo(video) {
  const filename = 'video_' + Date.now();

  showProgress('Downloading... (this may take a while)', 10);

  try {
    let result;

    if (video.type === 'hls' || video.url.includes('.m3u8')) {
      // HLS download
      const results = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: downloadHlsInPage,
        args: [video.url],
        world: 'MAIN'  // Run in page context to access cookies
      });
      result = results[0]?.result;

      if (result?.success) {
        showProgress('Saving file...', 90);

        // Convert base64 back to blob
        const binaryString = atob(result.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: 'video/mp2t' });
        const blobUrl = URL.createObjectURL(blob);

        chrome.downloads.download({
          url: blobUrl,
          filename: filename + '.ts',
          saveAs: true
        }, () => {
          showProgress('Download complete!', 100);
          setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
            hideProgress();
          }, 3000);
        });
      } else {
        throw new Error(result?.error || 'Download failed');
      }

    } else {
      // MP4/direct download
      const results = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: downloadMp4InPage,
        args: [video.url],
        world: 'MAIN'
      });
      result = results[0]?.result;

      if (result?.success) {
        showProgress('Saving file...', 90);

        const binaryString = atob(result.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: 'video/mp4' });
        const blobUrl = URL.createObjectURL(blob);

        chrome.downloads.download({
          url: blobUrl,
          filename: filename + '.mp4',
          saveAs: true
        }, () => {
          showProgress('Download complete!', 100);
          setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
            hideProgress();
          }, 3000);
        });
      } else {
        throw new Error(result?.error || 'Download failed');
      }
    }

  } catch (err) {
    alert('Download error: ' + err.message);
    hideProgress();
  }
}

async function scanPage() {
  const statusEl = document.getElementById('status');
  const videosEl = document.getElementById('videos');

  statusEl.className = 'status scanning';
  statusEl.textContent = 'Scanning page...';
  videosEl.innerHTML = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectVideos
    });

    foundVideos = results[0]?.result || [];

    if (foundVideos.length === 0) {
      statusEl.className = 'status';
      statusEl.textContent = 'No videos found on this page';
      videosEl.innerHTML = '<div class="no-videos">Try playing the video first, then scan again.</div>';
    } else {
      statusEl.className = 'status found';
      statusEl.textContent = `Found ${foundVideos.length} video(s)!`;

      foundVideos.forEach((video) => {
        const item = document.createElement('div');
        item.className = 'video-item';

        const typeEl = document.createElement('div');
        typeEl.className = 'type';
        typeEl.textContent = `${video.type.toUpperCase()} (${video.source})`;

        const urlEl = document.createElement('div');
        urlEl.className = 'url';
        urlEl.textContent = video.url.length > 80 ? video.url.substring(0, 80) + '...' : video.url;

        const btn = document.createElement('button');
        btn.className = 'download-btn';
        btn.textContent = 'Download';
        btn.onclick = () => downloadVideo(video);

        item.appendChild(typeEl);
        item.appendChild(urlEl);
        item.appendChild(btn);
        videosEl.appendChild(item);
      });
    }
  } catch (err) {
    statusEl.className = 'status error';
    statusEl.textContent = 'Error: ' + err.message;
  }
}

// Initial scan
scanPage();

// Refresh button
document.getElementById('refresh').addEventListener('click', scanPage);

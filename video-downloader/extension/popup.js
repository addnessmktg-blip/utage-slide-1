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

function getPageUrl() {
  return window.location.href;
}

let foundVideos = [];

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

// Download MP4 directly
async function downloadMp4(url, filename) {
  showProgress('Starting download...', 0);

  try {
    // Use chrome.downloads API
    chrome.downloads.download({
      url: url,
      filename: filename || 'video.mp4',
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        alert('Download failed: ' + chrome.runtime.lastError.message);
        hideProgress();
      } else {
        showProgress('Download started! Check your downloads.', 100);
        setTimeout(hideProgress, 3000);
      }
    });
  } catch (err) {
    alert('Download error: ' + err.message);
    hideProgress();
  }
}

// Parse m3u8 playlist
async function parseM3u8(url) {
  const response = await fetch(url);
  const text = await response.text();
  const lines = text.split('\n');

  const segments = [];
  const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

  // Check if this is a master playlist (contains other m3u8 references)
  const m3u8Lines = lines.filter(l => l.trim().endsWith('.m3u8'));
  if (m3u8Lines.length > 0) {
    // Get the highest quality stream (usually the last one or first)
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

// Download HLS stream
async function downloadHls(url, filename) {
  showProgress('Parsing playlist...', 5);

  try {
    // Parse m3u8 to get segment URLs
    const segments = await parseM3u8(url);

    if (segments.length === 0) {
      throw new Error('No segments found in playlist');
    }

    showProgress(`Found ${segments.length} segments. Downloading...`, 10);

    // Download all segments
    const chunks = [];
    for (let i = 0; i < segments.length; i++) {
      const percent = 10 + Math.floor((i / segments.length) * 80);
      showProgress(`Downloading segment ${i + 1}/${segments.length}...`, percent);

      const response = await fetch(segments[i]);
      const buffer = await response.arrayBuffer();
      chunks.push(new Uint8Array(buffer));
    }

    showProgress('Combining segments...', 92);

    // Combine all chunks
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    showProgress('Saving file...', 98);

    // Create blob and download
    const blob = new Blob([combined], { type: 'video/mp2t' });
    const blobUrl = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: blobUrl,
      filename: filename || 'video.ts',
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        alert('Download failed: ' + chrome.runtime.lastError.message);
      } else {
        showProgress('Download complete!', 100);
      }
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
        hideProgress();
      }, 3000);
    });

  } catch (err) {
    alert('HLS download error: ' + err.message);
    hideProgress();
  }
}

// Main download function
async function downloadVideo(video) {
  const filename = 'video_' + Date.now();

  if (video.type === 'hls' || video.url.includes('.m3u8')) {
    await downloadHls(video.url, filename + '.ts');
  } else if (video.type === 'mp4' || video.url.includes('.mp4')) {
    await downloadMp4(video.url, filename + '.mp4');
  } else {
    // Try direct download for other types
    await downloadMp4(video.url, filename + '.mp4');
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

      foundVideos.forEach((video, idx) => {
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

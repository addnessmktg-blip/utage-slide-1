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

  // 3. Search for video URLs in scripts and page content
  const pageContent = document.documentElement.innerHTML;

  // Look for mp4 URLs
  const mp4Regex = /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi;
  const mp4Matches = pageContent.match(mp4Regex) || [];
  mp4Matches.forEach(url => {
    const cleanUrl = url.replace(/["'\\]/g, '').split('?')[0] + (url.includes('?') ? '?' + url.split('?')[1]?.replace(/["'\\]/g, '') : '');
    if (!videos.some(v => v.url === cleanUrl)) {
      videos.push({ type: 'mp4', url: cleanUrl, source: 'page' });
    }
  });

  // Look for m3u8 (HLS) URLs
  const m3u8Regex = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi;
  const m3u8Matches = pageContent.match(m3u8Regex) || [];
  m3u8Matches.forEach(url => {
    const cleanUrl = url.replace(/["'\\]/g, '');
    if (!videos.some(v => v.url === cleanUrl)) {
      videos.push({ type: 'hls', url: cleanUrl, source: 'page' });
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

// Download video using background script (bypasses CORS)
async function downloadVideo(video) {
  const filename = 'video_' + Date.now();
  const isHls = video.type === 'hls' || video.url.includes('.m3u8');

  showProgress('Starting download...', 5);

  try {
    // Send download request to background script
    const response = await chrome.runtime.sendMessage({
      action: 'download',
      url: video.url,
      type: video.type,
      filename: filename
    });

    if (response.success) {
      showProgress('Saving file...', 95);

      // Convert base64 back to blob
      const binaryString = atob(response.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const ext = isHls ? '.ts' : '.mp4';
      const mimeType = isHls ? 'video/mp2t' : 'video/mp4';
      const blob = new Blob([bytes], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      chrome.downloads.download({
        url: blobUrl,
        filename: filename + ext,
        saveAs: true
      }, () => {
        showProgress('Download complete!', 100);
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          hideProgress();
        }, 3000);
      });

    } else {
      throw new Error(response.error || 'Download failed');
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

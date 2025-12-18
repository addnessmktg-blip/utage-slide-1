// Popup for Video Downloader v3.1 - Auto-parse m3u8 mode

let currentTabId = null;

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

// Download video
async function downloadVideo(video) {
  // Create timestamp-based filename
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = 'video_' + timestamp;
  const isHls = video.type === 'hls';

  showProgress('ダウンロード中...', 5);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'download',
      url: video.url,
      type: video.type,
      tabId: currentTabId
    });

    if (response.success) {
      showProgress('保存中...', 95);

      // Convert base64 to blob
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
        showProgress('完了！', 100);
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          hideProgress();
        }, 2000);
      });

    } else {
      throw new Error(response.error || 'Download failed');
    }

  } catch (err) {
    alert('エラー: ' + err.message);
    hideProgress();
  }
}

// Get status text
function getStatusText(video) {
  if (video.status === 'ready') {
    const encryptedText = video.encrypted ? ' (encrypted)' : '';
    return `${video.segmentCount} segments ready${encryptedText}`;
  } else if (video.status === 'parsing') {
    return 'Parsing...';
  } else if (video.status === 'auth_error') {
    return 'Auth error';
  } else if (video.status === 'parse_error') {
    return 'Parse error';
  }
  return video.status || '';
}

// Get status color
function getStatusColor(video) {
  if (video.status === 'ready' && video.segmentCount > 0) {
    return '#4ade80'; // Green
  } else if (video.status === 'auth_error' || video.status === 'parse_error') {
    return '#f87171'; // Red
  }
  return '#fbbf24'; // Yellow
}

// Load captured videos from background
async function loadCapturedVideos() {
  const statusEl = document.getElementById('status');
  const videosEl = document.getElementById('videos');

  statusEl.className = 'status scanning';
  statusEl.textContent = 'Loading...';
  videosEl.innerHTML = '';

  try {
    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;

    // Get captured videos from background
    const response = await chrome.runtime.sendMessage({
      action: 'getCapturedVideos',
      tabId: tab.id
    });

    const videos = response.videos || [];

    if (videos.length === 0) {
      statusEl.className = 'status';
      statusEl.innerHTML = `
        <div style="text-align: center;">
          <div style="margin-bottom: 10px;">動画が見つかりません</div>
          <div style="font-size: 11px; color: #94a3b8;">
            ページを読み込むと自動でキャプチャされます
          </div>
        </div>
      `;
    } else {
      statusEl.className = 'status found';
      statusEl.textContent = `${videos.length} video(s) found!`;

      videos.forEach((video) => {
        const item = document.createElement('div');
        item.className = 'video-item';

        const typeEl = document.createElement('div');
        typeEl.className = 'type';
        typeEl.innerHTML = `
          <span>${video.type.toUpperCase()}</span>
          <span style="color: ${getStatusColor(video)}; margin-left: 8px;">
            ${getStatusText(video)}
          </span>
        `;

        const urlEl = document.createElement('div');
        urlEl.className = 'url';
        urlEl.textContent = video.url.length > 80 ? video.url.substring(0, 80) + '...' : video.url;

        const btn = document.createElement('button');
        btn.className = 'download-btn';

        if (video.status === 'ready' && video.segmentCount > 0) {
          btn.textContent = `Download (${video.segmentCount} parts)`;
          btn.onclick = () => downloadVideo(video);
        } else if (video.type !== 'hls') {
          btn.textContent = 'Download';
          btn.onclick = () => downloadVideo(video);
        } else {
          btn.textContent = 'Not available';
          btn.disabled = true;
          btn.style.opacity = '0.5';
        }

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

// Initial load
loadCapturedVideos();

// Refresh button
document.getElementById('refresh').addEventListener('click', loadCapturedVideos);

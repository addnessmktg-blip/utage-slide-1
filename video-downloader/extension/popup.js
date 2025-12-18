// Popup for Video Downloader v4.0 - IMAGE HACKER style UI

let currentTabId = null;
let pageTitle = '';
let currentVideos = [];

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'downloadProgress') {
    const { current, total, percent } = message;
    showProgress(`ダウンロード中... ${current}/${total} (${percent}%)`, percent);
  }
});

// Clean filename (remove invalid characters)
function cleanFilename(name) {
  if (!name) return '';
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 100);
}

// Filter videos: hide HLS if MP4 exists, remove duplicates
function filterVideos(videos) {
  const hasMp4 = videos.some(v => v.type === 'mp4');
  if (hasMp4) {
    return videos.filter(v => v.type === 'mp4');
  }

  // For HLS: deduplicate similar URLs (hls_variant vs hls_playlist from same source)
  const seen = new Set();
  const deduplicated = videos.filter(v => {
    // Extract base identifier from URL (remove hls_variant/hls_playlist differences)
    let key = v.url;
    // For googlevideo URLs, use a simplified key
    if (v.url.includes('googlevideo.com')) {
      // Just keep one per domain+segment count combo
      key = 'googlevideo_' + (v.segmentCount || 0);
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return deduplicated.sort((a, b) => {
    if (a.type !== 'hls' && b.type === 'hls') return -1;
    if (a.type === 'hls' && b.type !== 'hls') return 1;
    return (a.segmentCount || 0) - (b.segmentCount || 0);
  });
}

// Progress UI
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

// Get folder name from input
function getFolder() {
  const folderInput = document.getElementById('foldername');

  // Get folder name (use page title if empty)
  let folder = folderInput.value.trim();
  if (!folder) {
    folder = pageTitle || 'VIDEO_HACKER';
  }
  // Sanitize folder name
  folder = folder.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.+$/g, '');

  return folder;
}

// Download a single video with optional custom filename
async function downloadVideo(video, customFilename = null) {
  const folder = getFolder();
  // Use custom filename, or generate default with timestamp
  let filename = customFilename;
  if (!filename) {
    filename = 'video_' + Date.now();
  }
  // Sanitize filename
  filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.+$/g, '');

  const isHls = video.type === 'hls';
  const ext = isHls ? '.ts' : '.mp4';
  const fullPath = folder + '/' + filename + ext;

  showProgress('ダウンロード開始...', 1);

  try {
    // Send download request to background (downloads directly, no base64!)
    const response = await chrome.runtime.sendMessage({
      action: 'download',
      url: video.url,
      type: video.type,
      tabId: currentTabId,
      filename: fullPath
    });

    if (response.success) {
      showProgress('完了！', 100);
      setTimeout(() => {
        hideProgress();
      }, 2000);
    } else {
      throw new Error(response.error || 'ダウンロード失敗');
    }

  } catch (err) {
    alert('エラー: ' + err.message);
    hideProgress();
  }
}

// Get status text
function getStatusText(video) {
  if (video.status === 'ready') {
    return `${video.segmentCount}パート準備完了`;
  } else if (video.status === 'parsing') {
    return '解析中...';
  } else if (video.status === 'auth_error') {
    return '認証エラー';
  } else if (video.status === 'parse_error') {
    return '解析エラー';
  } else if (video.status === 'captured') {
    return '取得済み';
  }
  return '';
}

// Update main download button
function updateMainButton(videos) {
  const btn = document.getElementById('mainDownload');
  const count = videos.length;

  if (count > 0) {
    btn.disabled = false;
    btn.innerHTML = `
      Download ${count} Video${count > 1 ? 's' : ''}
      <div class="sub-text">${count}本の動画を保存</div>
    `;
  } else {
    btn.disabled = true;
    btn.innerHTML = `
      Download 0 Videos
      <div class="sub-text">0本の動画を保存</div>
    `;
  }
}

// Load captured videos
async function loadCapturedVideos() {
  const statusEl = document.getElementById('status');
  const videosEl = document.getElementById('videos');
  const foldernameInput = document.getElementById('foldername');

  statusEl.textContent = '読み込み中...';
  videosEl.innerHTML = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;
    pageTitle = cleanFilename(tab.title || '');

    // Auto-fill folder name if empty (use page title)
    if (!foldernameInput.value) {
      foldernameInput.value = pageTitle;
    }

    const response = await chrome.runtime.sendMessage({
      action: 'getCapturedVideos',
      tabId: tab.id
    });

    const videos = response.videos || [];
    const filteredVideos = filterVideos(videos);
    currentVideos = filteredVideos;

    updateMainButton(filteredVideos);

    if (filteredVideos.length === 0) {
      statusEl.textContent = '動画が見つかりません';
      videosEl.innerHTML = `
        <div class="no-videos">
          <div class="no-videos-icon">🎬</div>
          <div>ページを読み込むと自動でキャプチャされます</div>
        </div>
      `;
    } else {
      statusEl.textContent = `${filteredVideos.length}個の動画が見つかりました`;

      filteredVideos.forEach((video, index) => {
        const item = document.createElement('div');
        item.className = 'video-item';

        const statusColor = video.status === 'ready' || video.status === 'captured' ? '#22c55e' : '#eab308';

        item.innerHTML = `
          <div class="video-header">
            <span class="type-badge">${video.type.toUpperCase()}</span>
            <span class="status" style="color: ${statusColor}">${getStatusText(video)}</span>
          </div>
          <div class="url">${video.url.substring(0, 60)}...</div>
          <div class="video-filename-row">
            <input type="text" class="video-filename-input" id="videoFilename${index}" placeholder="ファイル名を入力">
            <button class="video-download-btn" data-index="${index}">保存</button>
          </div>
        `;

        // Add click handler for the download button
        const downloadBtn = item.querySelector('.video-download-btn');
        downloadBtn.onclick = (e) => {
          e.stopPropagation();
          const filenameInput = item.querySelector('.video-filename-input');
          const customFilename = filenameInput.value.trim();
          downloadVideo(video, customFilename || null);
        };

        videosEl.appendChild(item);
      });
    }
  } catch (err) {
    statusEl.textContent = 'エラー: ' + err.message;
  }
}

// Main download button click
document.getElementById('mainDownload').addEventListener('click', () => {
  if (currentVideos.length > 0) {
    downloadVideo(currentVideos[0]);
  }
});

// Refresh button
document.getElementById('refresh').addEventListener('click', loadCapturedVideos);

// Initial load
loadCapturedVideos();

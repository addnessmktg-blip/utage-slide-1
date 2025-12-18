// Popup for Video Downloader v4.0 - IMAGE HACKER style UI

let currentTabId = null;
let pageTitle = '';
let currentVideos = [];

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

// Filter videos: hide HLS if MP4 exists
function filterVideos(videos) {
  const hasMp4 = videos.some(v => v.type === 'mp4');
  if (hasMp4) {
    return videos.filter(v => v.type === 'mp4');
  }
  return videos.sort((a, b) => {
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

// Get full path (folder/filename) from inputs
function getFullPath() {
  const folderInput = document.getElementById('foldername');
  const filenameInput = document.getElementById('filename');

  // Get folder name (use page title if empty)
  let folder = folderInput.value.trim();
  if (!folder) {
    folder = pageTitle || 'VIDEO_HACKER';
  }
  // Sanitize folder name
  folder = folder.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.+$/g, '');

  // Get filename (required)
  let filename = filenameInput.value.trim();
  if (!filename) {
    filename = 'video_' + Date.now();
  }
  // Sanitize filename
  filename = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\.+$/g, '');

  console.log('Folder:', folder, 'Filename:', filename);
  return { folder, filename };
}

// Download a single video with optional custom filename
async function downloadVideo(video, customFilename = null) {
  const { folder, filename: defaultFilename } = getFullPath();
  const filename = customFilename || defaultFilename;
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

      const binaryString = atob(response.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const ext = isHls ? '.ts' : '.mp4';
      const mimeType = isHls ? 'video/mp2t' : 'video/mp4';
      const blob = new Blob([bytes], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      // Create full path: folder/filename.ext
      const fullPath = folder + '/' + filename + ext;
      console.log('Saving to:', fullPath);

      // Register the filename with background script
      await chrome.runtime.sendMessage({
        action: 'registerDownload',
        blobUrl: blobUrl,
        filename: fullPath
      });

      // Use chrome.downloads.download for proper filename/folder support
      chrome.downloads.download({
        url: blobUrl,
        filename: fullPath,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('Download error:', chrome.runtime.lastError);
          alert('エラー: ' + chrome.runtime.lastError.message);
          hideProgress();
        } else {
          console.log('Download started with ID:', downloadId);
          showProgress('完了！', 100);
          setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
            hideProgress();
          }, 2000);
        }
      });

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

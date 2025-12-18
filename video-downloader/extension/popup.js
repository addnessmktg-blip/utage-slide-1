// Popup for Video Downloader v3 - Network Capture Mode

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
  const filename = 'video_' + Date.now();
  const isHls = video.type === 'hls' || video.type === 'segment';

  showProgress('Downloading...', 5);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'download',
      url: video.url,
      type: video.type,
      tabId: currentTabId
    });

    if (response.success) {
      showProgress('Saving...', 95);

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
        showProgress('Complete!', 100);
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          hideProgress();
        }, 2000);
      });

    } else {
      throw new Error(response.error || 'Download failed');
    }

  } catch (err) {
    alert('Error: ' + err.message);
    hideProgress();
  }
}

// Load captured videos from background
async function loadCapturedVideos() {
  const statusEl = document.getElementById('status');
  const videosEl = document.getElementById('videos');

  statusEl.className = 'status scanning';
  statusEl.textContent = 'Loading captured videos...';
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
          <div style="margin-bottom: 10px;">No videos captured yet</div>
          <div style="font-size: 11px; color: #94a3b8;">
            Play the video first, then click "Refresh"
          </div>
        </div>
      `;
    } else {
      statusEl.className = 'status found';
      statusEl.textContent = `Captured ${videos.length} video(s)!`;

      videos.forEach((video) => {
        const item = document.createElement('div');
        item.className = 'video-item';

        const typeEl = document.createElement('div');
        typeEl.className = 'type';
        let typeText = video.type.toUpperCase();
        if (video.segmentCount) {
          typeText += ` (${video.segmentCount} segments)`;
        }
        typeEl.textContent = typeText;

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

// Initial load
loadCapturedVideos();

// Refresh button
document.getElementById('refresh').addEventListener('click', loadCapturedVideos);

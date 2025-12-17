// Local API endpoint (Tauri app runs a local HTTP server)
const API_BASE = 'http://localhost:8765';

// Supported URL patterns
const SUPPORTED_PATTERNS = [
  /youtube\.com\/watch/,
  /youtu\.be\//,
  /youtube\.com\/shorts/,
  /twitter\.com\/.*\/status/,
  /x\.com\/.*\/status/,
  /tiktok\.com/,
  /vimeo\.com/,
];

// Check if URL is supported
function isSupportedUrl(url) {
  return SUPPORTED_PATTERNS.some(pattern => pattern.test(url));
}

// Check if the desktop app is running
async function checkConnection() {
  try {
    const response = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Send download request to desktop app
async function sendDownloadRequest(url) {
  try {
    const response = await fetch(`${API_BASE}/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error('Download request failed');
    }

    return await response.json();
  } catch (error) {
    throw error;
  }
}

// Update UI based on connection status
function updateStatus(connected) {
  const statusEl = document.getElementById('status');
  const urlSection = document.getElementById('url-section');
  const messageEl = document.getElementById('message');

  if (connected) {
    statusEl.className = 'status connected';
    statusEl.textContent = 'アプリに接続済み';
    urlSection.style.display = 'block';
    messageEl.style.display = 'none';
  } else {
    statusEl.className = 'status disconnected';
    statusEl.textContent = 'アプリが起動していません';
    urlSection.style.display = 'none';
    messageEl.style.display = 'block';
    messageEl.innerHTML = 'デスクトップアプリを起動してください。<br><br>まだインストールしていない場合は、<br>ダウンロードしてインストールしてください。';
  }
}

// Update current URL display
function updateUrlDisplay(url) {
  const urlEl = document.getElementById('current-url');
  const downloadBtn = document.getElementById('download-btn');

  // Truncate long URLs for display
  const displayUrl = url.length > 50 ? url.substring(0, 50) + '...' : url;
  urlEl.textContent = displayUrl;

  // Enable/disable download button based on URL support
  if (isSupportedUrl(url)) {
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'ダウンロード';
  } else {
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'このサイトは非対応です';
  }
}

// Initialize popup
async function init() {
  // Check connection first
  const connected = await checkConnection();
  updateStatus(connected);

  // Get current tab URL
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    updateUrlDisplay(tab.url);

    // Set up download button
    const downloadBtn = document.getElementById('download-btn');
    downloadBtn.addEventListener('click', async () => {
      if (!connected) {
        alert('デスクトップアプリが起動していません。');
        return;
      }

      downloadBtn.disabled = true;
      downloadBtn.textContent = '送信中...';

      try {
        await sendDownloadRequest(tab.url);
        downloadBtn.textContent = '送信しました！';
        downloadBtn.style.backgroundColor = '#22c55e';

        // Close popup after a short delay
        setTimeout(() => {
          window.close();
        }, 1000);
      } catch (error) {
        downloadBtn.textContent = 'エラーが発生しました';
        downloadBtn.style.backgroundColor = '#ef4444';

        setTimeout(() => {
          downloadBtn.disabled = false;
          downloadBtn.textContent = 'ダウンロード';
          downloadBtn.style.backgroundColor = '';
        }, 2000);
      }
    });
  }
}

// Run when popup opens
document.addEventListener('DOMContentLoaded', init);

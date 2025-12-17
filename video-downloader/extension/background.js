// Background service worker for Video Downloader extension

const API_BASE = 'http://localhost:8765';

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'download') {
    handleDownload(request.url)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (request.action === 'checkHealth') {
    checkHealth()
      .then(connected => sendResponse({ connected }))
      .catch(() => sendResponse({ connected: false }));
    return true;
  }
});

// Check if desktop app is running
async function checkHealth() {
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
async function handleDownload(url) {
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

  return response.json();
}

// Optional: Show notification when download starts
chrome.runtime.onInstalled.addListener(() => {
  console.log('Video Downloader extension installed');
});

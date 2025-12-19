// Content script to capture video thumbnails

// Capture thumbnail from video element
function captureVideoThumbnail(video) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch (e) {
    console.log('Failed to capture thumbnail:', e);
    return null;
  }
}

// Find all video elements and capture thumbnails
function captureAllThumbnails() {
  const videos = document.querySelectorAll('video');
  const thumbnails = [];

  videos.forEach((video, index) => {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const thumbnail = captureVideoThumbnail(video);
      if (thumbnail) {
        thumbnails.push({
          index,
          src: video.src || video.currentSrc,
          thumbnail,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration
        });
      }
    }
  });

  return thumbnails;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureThumbnails') {
    const thumbnails = captureAllThumbnails();
    sendResponse({ thumbnails });
    return true;
  }
});

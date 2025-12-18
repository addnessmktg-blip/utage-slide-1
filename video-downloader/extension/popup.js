// Video detection function to be injected into the page
function detectVideos() {
  const videos = [];
  
  // 1. Find HTML5 video elements
  document.querySelectorAll('video').forEach((video, idx) => {
    if (video.src) {
      videos.push({
        type: 'video',
        url: video.src,
        source: 'video element'
      });
    }
    // Check source elements inside video
    video.querySelectorAll('source').forEach(source => {
      if (source.src) {
        videos.push({
          type: 'video',
          url: source.src,
          source: 'source element'
        });
      }
    });
  });
  
  // 2. Find iframes (video embeds)
  document.querySelectorAll('iframe').forEach((iframe, idx) => {
    const src = iframe.src;
    if (src) {
      // Check for known video platforms
      if (src.includes('youtube') || src.includes('youtu.be')) {
        videos.push({ type: 'youtube', url: src, source: 'iframe' });
      } else if (src.includes('vimeo')) {
        videos.push({ type: 'vimeo', url: src, source: 'iframe' });
      } else if (src.includes('wistia')) {
        videos.push({ type: 'wistia', url: src, source: 'iframe' });
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
    if (!videos.some(v => v.url === url)) {
      videos.push({ type: 'mp4', url: url, source: 'script' });
    }
  });
  
  // Look for m3u8 (HLS) URLs
  const m3u8Regex = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi;
  const m3u8Matches = scriptContent.match(m3u8Regex) || [];
  m3u8Matches.forEach(url => {
    if (!videos.some(v => v.url === url)) {
      videos.push({ type: 'hls', url: url, source: 'script' });
    }
  });
  
  // 4. Search in data attributes
  document.querySelectorAll('[data-src], [data-video], [data-url], [data-video-url]').forEach(el => {
    const url = el.dataset.src || el.dataset.video || el.dataset.url || el.dataset.videoUrl;
    if (url && (url.includes('.mp4') || url.includes('.m3u8') || url.includes('video'))) {
      if (!videos.some(v => v.url === url)) {
        videos.push({ type: 'data-attr', url: url, source: 'data attribute' });
      }
    }
  });
  
  // 5. Look for Vimeo player config
  const vimeoConfigRegex = /"config_url"\s*:\s*"([^"]+)"/g;
  let match;
  while ((match = vimeoConfigRegex.exec(scriptContent)) !== null) {
    videos.push({ type: 'vimeo-config', url: match[1].replace(/\\\//g, '/'), source: 'vimeo config' });
  }
  
  // 6. Look for Wistia videos
  const wistiaRegex = /wistia\.com\/(?:embed|medias)\/([a-zA-Z0-9]+)/g;
  while ((match = wistiaRegex.exec(scriptContent)) !== null) {
    videos.push({ type: 'wistia', url: `https://fast.wistia.com/embed/medias/${match[1]}.json`, source: 'wistia' });
  }
  
  // Deduplicate by URL
  const seen = new Set();
  return videos.filter(v => {
    if (seen.has(v.url)) return false;
    seen.add(v.url);
    return true;
  });
}

// Get page URL
function getPageUrl() {
  return window.location.href;
}

let foundVideos = [];

async function scanPage() {
  const statusEl = document.getElementById('status');
  const videosEl = document.getElementById('videos');
  
  statusEl.className = 'status scanning';
  statusEl.textContent = 'Scanning page...';
  videosEl.innerHTML = '';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Inject and execute video detection
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: detectVideos
    });
    
    const pageUrlResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: getPageUrl
    });
    
    const pageUrl = pageUrlResults[0]?.result || tab.url;
    foundVideos = results[0]?.result || [];
    
    if (foundVideos.length === 0) {
      statusEl.className = 'status';
      statusEl.textContent = 'No videos found on this page';
      videosEl.innerHTML = '<div class="no-videos">Try scrolling or playing the video first, then scan again.</div>';
      
      // Add option to send page URL to app for analysis
      const sendPageBtn = document.createElement('button');
      sendPageBtn.textContent = 'Send Page URL to App';
      sendPageBtn.style.marginTop = '10px';
      sendPageBtn.onclick = () => sendToApp(pageUrl);
      videosEl.appendChild(sendPageBtn);
    } else {
      statusEl.className = 'status found';
      statusEl.textContent = `Found ${foundVideos.length} video(s)!`;
      
      foundVideos.forEach((video, idx) => {
        const item = document.createElement('div');
        item.className = 'video-item';
        
        const typeEl = document.createElement('div');
        typeEl.className = 'type';
        typeEl.textContent = `${video.type} (${video.source})`;
        
        const urlEl = document.createElement('div');
        urlEl.className = 'url';
        urlEl.textContent = video.url.length > 100 ? video.url.substring(0, 100) + '...' : video.url;
        
        const btn = document.createElement('button');
        btn.textContent = 'Send to App';
        btn.onclick = () => sendToApp(video.url);
        
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

async function sendToApp(url) {
  try {
    // Send to local Tauri app HTTP server
    const response = await fetch('http://localhost:8765/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
    });
    
    if (response.ok) {
      alert('Sent to Video Downloader app! Check the app for download options.');
    } else {
      alert('Failed to send. Make sure Video Downloader app is running.');
    }
  } catch (err) {
    alert('Could not connect to Video Downloader app.\n\nMake sure the app is running first!');
  }
}

// Initial scan
scanPage();

// Refresh button
document.getElementById('refresh').addEventListener('click', scanPage);

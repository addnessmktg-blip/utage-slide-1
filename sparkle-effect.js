// ============================================
// カスタムJSに貼り付けてください
// （<script>タグは不要です）
// ============================================

(function() {
  // 編集モード判定
  var isEditMode = (
    window.location.href.indexOf('/edit') !== -1 ||
    window.location.href.indexOf('/admin') !== -1 ||
    window.location.href.indexOf('preview=') !== -1 ||
    document.querySelector('.editor-container') ||
    document.querySelector('#editor') ||
    document.querySelector('[data-edit-mode]') ||
    window.parent !== window
  );

  if (isEditMode) {
    return; // 編集画面ではキラキラ演出を無効化
  }

  // キラキラ生成の設定
  var config = {
    sparkleCount: 20,       // キラキラの数
    starCount: 8,           // 星型キラキラの数
    minDelay: 0,            // 最小遅延（秒）
    maxDelay: 3,            // 最大遅延（秒）
    minDuration: 1.5,       // 最小アニメーション時間（秒）
    maxDuration: 3          // 最大アニメーション時間（秒）
  };

  // ランダム値生成関数
  function random(min, max) {
    return Math.random() * (max - min) + min;
  }

  // キラキラ粒子を生成
  function createSparkle(overlay) {
    var sparkle = document.createElement('div');
    sparkle.className = 'sparkle';
    sparkle.style.left = random(5, 95) + '%';
    sparkle.style.top = random(5, 95) + '%';
    sparkle.style.animationDelay = random(config.minDelay, config.maxDelay) + 's';
    sparkle.style.animationDuration = random(config.minDuration, config.maxDuration) + 's';

    // サイズのバリエーション
    var size = random(6, 14);
    sparkle.style.width = size + 'px';
    sparkle.style.height = size + 'px';

    overlay.appendChild(sparkle);
  }

  // 星型キラキラを生成
  function createStar(overlay) {
    var star = document.createElement('div');
    star.className = 'sparkle-star';
    star.style.left = random(10, 90) + '%';
    star.style.top = random(10, 90) + '%';
    star.style.animationDelay = random(config.minDelay, config.maxDelay + 1) + 's';
    star.style.animationDuration = random(config.minDuration + 0.5, config.maxDuration + 1) + 's';

    overlay.appendChild(star);
  }

  // キラキラ演出を初期化
  function initSparkles() {
    var overlay = document.getElementById('sparkle-overlay');

    if (!overlay) {
      // 要素がまだ読み込まれていない場合は再試行
      setTimeout(initSparkles, 100);
      return;
    }

    // 既存のキラキラをクリア
    overlay.innerHTML = '';

    // キラキラ粒子を生成
    for (var i = 0; i < config.sparkleCount; i++) {
      createSparkle(overlay);
    }

    // 星型キラキラを生成
    for (var j = 0; j < config.starCount; j++) {
      createStar(overlay);
    }
  }

  // キラキラを定期的にリフレッシュ（位置をランダム化）
  function refreshSparkles() {
    var overlay = document.getElementById('sparkle-overlay');
    if (!overlay) return;

    var sparkles = overlay.querySelectorAll('.sparkle');
    var stars = overlay.querySelectorAll('.sparkle-star');

    // 一部のキラキラの位置を更新
    for (var i = 0; i < sparkles.length; i++) {
      if (Math.random() > 0.7) {
        sparkles[i].style.left = random(5, 95) + '%';
        sparkles[i].style.top = random(5, 95) + '%';
      }
    }

    for (var j = 0; j < stars.length; j++) {
      if (Math.random() > 0.7) {
        stars[j].style.left = random(10, 90) + '%';
        stars[j].style.top = random(10, 90) + '%';
      }
    }
  }

  // DOMContentLoaded後に初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSparkles);
  } else {
    initSparkles();
  }

  // 5秒ごとにキラキラ位置をリフレッシュ
  setInterval(refreshSparkles, 5000);
})();

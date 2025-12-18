# Video Downloader

YouTube、Twitter/X、TikTok、Vimeo などから動画をダウンロードできるデスクトップアプリです。

## 機能

- YouTube動画のダウンロード（複数画質対応）
- Twitter/X動画のダウンロード
- TikTok動画のダウンロード
- Vimeo動画のダウンロード
- その他の埋め込み動画
- Chrome拡張機能でブラウザから直接ダウンロード

## インストール方法

### デスクトップアプリ

#### Windows
1. `video-downloader_x.x.x_x64-setup.exe` をダウンロード
2. ダブルクリックしてインストール
3. インストール完了後、スタートメニューから起動

#### macOS
1. `video-downloader_x.x.x_x64.dmg` をダウンロード
2. DMGファイルを開く
3. アプリをApplicationsフォルダにドラッグ
4. 初回起動時は右クリック→「開く」を選択

#### Linux
1. `video-downloader_x.x.x_amd64.deb` または `.AppImage` をダウンロード
2. DEBの場合: `sudo dpkg -i video-downloader_x.x.x_amd64.deb`
3. AppImageの場合: 実行権限を付与して起動

### Chrome拡張機能（オプション）

ブラウザから直接ダウンロードしたい場合：

1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をオンにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `extension` フォルダを選択
5. 拡張機能がインストールされます

## 使い方

### デスクトップアプリのみで使う場合

1. アプリを起動
2. ダウンロードしたい動画のURLをコピー
3. アプリの入力欄にペースト
4. 「解析」ボタンをクリック
5. 品質を選択
6. 「ダウンロード開始」をクリック
7. ダウンロードフォルダに保存されます

### Chrome拡張機能を使う場合

1. **デスクトップアプリを先に起動しておく**
2. ダウンロードしたい動画のページを開く
3. 右上のVideo Downloaderアイコンをクリック
4. 「ダウンロード」ボタンをクリック
5. デスクトップアプリが自動で開き、ダウンロードが始まります

## 対応サイト

| サイト | 対応状況 |
|--------|----------|
| YouTube | ✅ 対応 |
| Twitter/X | ✅ 対応 |
| TikTok | ✅ 対応 |
| Vimeo | ✅ 対応 |
| その他（埋め込み動画） | ⚠️ 部分対応 |

## 開発者向け情報

### 必要な環境

- Node.js 18+
- Rust 1.70+
- （Linux）libwebkit2gtk-4.1-dev, librsvg2-dev, libgtk-3-dev

### ビルド方法

```bash
# 依存関係のインストール
npm install

# 開発モードで起動
npm run tauri dev

# プロダクションビルド
npm run tauri build
```

### プロジェクト構成

```
video-downloader/
├── src/                  # Reactフロントエンド
│   ├── App.tsx          # メインコンポーネント
│   └── App.css          # スタイル
├── src-tauri/           # Rustバックエンド
│   ├── src/
│   │   ├── lib.rs       # エントリーポイント
│   │   ├── extractors/  # 動画情報抽出
│   │   └── downloader/  # ダウンロード処理
│   └── Cargo.toml
├── extension/           # Chrome拡張機能
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   └── background.js
└── package.json
```

## 技術スタック

- **フロントエンド**: React + TypeScript
- **バックエンド**: Rust + Tauri 2.0
- **拡張機能**: Chrome Extension Manifest V3

## 注意事項

- 個人利用目的のツールです
- 著作権を侵害する目的での使用は禁止です
- ダウンロードは自己責任で行ってください

## ライセンス

MIT License

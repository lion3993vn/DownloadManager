<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="DownloadManager logo">

# DownloadManager

**A free, open-source download manager and download accelerator for Windows, macOS and Linux.**
Splits every file into parallel connections, resumes after crashes, downloads videos from YouTube, TikTok and 1,000+ sites, and catches downloads straight from Chrome, Edge and Firefox. A lightweight IDM alternative built with Rust and Tauri.

[![Latest release](https://img.shields.io/github/v/release/lion3993vn/DownloadManager?label=download&sort=semver)](https://github.com/lion3993vn/DownloadManager/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/lion3993vn/DownloadManager/total)](https://github.com/lion3993vn/DownloadManager/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/lion3993vn/DownloadManager/build.yml?branch=main)](https://github.com/lion3993vn/DownloadManager/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**English** · [Tiếng Việt](README.vi.md)

[**⬇ Download for Windows / macOS / Linux**](https://github.com/lion3993vn/DownloadManager/releases/latest)

</div>

## Features

- **Multi-connection downloads.** Each file is split into segments fetched in parallel over HTTP Range requests, up to 32 connections per file.
- **Work stealing.** A connection that finishes early takes over half of the largest remaining segment, so a download never crawls on one slow last piece.
- **Adapts to the server.** On 429/503 (too many connections) it drops connections by itself; servers without Range support fall back to a single stream.
- **Pause and resume**, even after closing the app or a crash: progress is saved to SQLite every second. If the file changed on the server (ETag, Last-Modified or size), it starts over instead of producing a corrupt file.
- **Video downloader.** Paste a YouTube, TikTok, Facebook, Instagram, X (Twitter), Vimeo, Bilibili, Twitch, SoundCloud or Douyin link (and any other site [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports). Pick the quality (4K, 1080p, 720p…) or MP3 audio. yt-dlp and ffmpeg are installed from inside the app in one click.
- **HLS / m3u8 streams** are downloaded in parallel, including AES-128 encrypted and fMP4 playlists, with no ffmpeg needed.
- **Browser integration.** An extension for Chrome, Edge, Brave, Opera, Vivaldi, Cốc Cốc and Firefox hands downloads to the app with their cookies, referrer and user agent, and adds a "Download video" button on video pages.
- Queue, global speed limit, statistics page, light and dark themes, system tray, start with the system.
- English and Vietnamese interface (follows the system language; change it in *Settings*).

## Install

Get the installer from [GitHub Releases](https://github.com/lion3993vn/DownloadManager/releases/latest):

| Platform | File |
| --- | --- |
| Windows 10/11 | `DownloadManager_x.y.z_x64-setup.exe` (recommended: per-user install, no admin rights) or `.msi` |
| macOS (Apple Silicon / Intel) | `.dmg` |
| Linux | `.deb` or `.AppImage` |

The app updates itself: it checks for a new version at startup and every 6 hours. Updates are signed, and unfinished downloads continue after the restart.

## Connect your browser

The installer ships the browser extension. Open the app and click **Connect browser** (the card at the bottom of the sidebar; it also opens on first launch). The app:

1. Unpacks the extension to a fixed folder and **writes the pairing code into it**, so there is nothing to type.
2. Detects your browsers (Chrome, Edge, Cốc Cốc, Brave, Opera, Vivaldi, Firefox).
3. **Open <browser>** opens a new window on your last used profile and copies `chrome://extensions` to the clipboard: paste it into the address bar.
4. Turn on *Developer mode* → *Load unpacked* → paste the folder path (the **Copy** button in the app).
5. The app notices when the extension connects.

> Why not a fully automatic install? Chrome and Edge block other programs from installing extensions that are not in their stores (and from opening `chrome://` pages from the command line); Firefox only installs extensions signed by Mozilla. One-click install needs store listings on the Chrome Web Store, Edge Add-ons and AMO.

The extension takes over downloads by file type (zip, exe, iso, mp4, pdf…) or size (over 20 MB by default; change it in the extension options). Right-click any link → *Download with DownloadManager* to send it to the app.

## How it works

```
crates/dm-core   Pure Rust engine (tokio + reqwest): probing, segmenting, workers, work stealing,
                 resume, rate limiting, HLS, yt-dlp integration, SQLite. No Tauri dependency.
crates/dm-cli    Command-line tool to test and benchmark the engine.
src-tauri        Tauri 2 app: commands for the UI, HTTP bridge for the extension (127.0.0.1:47890), tray.
src              React + TypeScript + Tailwind interface.
extension        Manifest V3 extension (shared by Chromium browsers and Firefox).
```

Capturing a browser download:

```
Browser ──downloads.onCreated──▶ extension ──POST /api/capture (X-DM-Token)──▶ app
            (download paused)        │                                         │
                                     └─ app not running → the browser goes on   └─ confirm dialog → engine
```

Bridge security: it only binds `127.0.0.1`; requests carrying a web page `Origin` are rejected (403); captures require the pairing token (401 otherwise). Pairing asks you to click "Allow" in the app.

## Build from source

Requirements: Rust stable, Node 22+, pnpm 10. Windows needs the MSVC C++ build tools and WebView2; Linux needs `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev`.

```bash
pnpm install
pnpm tauri dev          # run the app
cargo test -p dm-core   # engine tests (fake server: Range, no Range, dropped connections, 429, changed ETag…)
pnpm tauri build        # installers (.msi/.exe, .dmg, .deb/.AppImage)
pnpm pack:extension     # zip the extension → dist-extension/*.zip
```

Benchmark the engine without the UI:

```bash
cargo run --release -p dm-cli -- https://example.com/big.iso -c 8 -o ./out
```

> Tip (Windows + OneDrive): point `CARGO_TARGET_DIR` outside the synced folder so OneDrive does not sync gigabytes of build output.

### Signed updates

Updates are signed with minisign, and the app only installs a build whose signature matches the public key in `tauri.conf.json` (`plugins.updater`).

- **CI**: the repository secret `TAURI_SIGNING_PRIVATE_KEY` holds the private key. Each `v*` tag produces a release with `.sig` files and `latest.json` (updater endpoint: `releases/latest/download/latest.json`).
- **Local**: `TAURI_SIGNING_PRIVATE_KEY=<path or key> TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" pnpm tauri build`.
- **Do not lose the private key.** Without it, installed copies can no longer receive updates.

### Releasing

1. While working, record changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
2. Run `pnpm release 0.6.0` (`--dry-run` to preview). It bumps every version file, turns `[Unreleased]` into the version, commits, tags, pushes, and creates a draft release with your `gh` login.
3. CI builds and signs Windows/macOS/Linux, attaches the installers, the extension and `latest.json`, writes the release notes and publishes. Running apps see the update within 6 hours.

Full procedure: [docs/RELEASING.md](docs/RELEASING.md).

### Translations

UI strings live in [`src/i18n/messages/`](src/i18n/messages) (Vietnamese and English side by side; TypeScript rejects a missing translation) and the extension's in [`extension/_locales/`](extension/_locales). Pull requests for new languages are welcome.

## Limitations

- Not supported yet: playlists and live streams on video sites, HLS with separate audio when not going through yt-dlp, DRM-protected video, FTP and BitTorrent.
- Downloads in incognito / private windows are not captured.
- Firefox only loads the extension temporarily (removed when Firefox closes) until it is signed by Mozilla.
- Single-stream downloads (servers without Range support) cannot be paused and resumed: resuming starts over.

## License

[MIT](LICENSE)

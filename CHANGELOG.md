# Changelog

**English** · [Tiếng Việt](CHANGELOG.vi.md)

All notable changes to DownloadManager. Write new changes under **[Unreleased]** in **both** this file and [CHANGELOG.vi.md](CHANGELOG.vi.md) (same versions, same content). `pnpm release <version>` turns that section into the new version; its content becomes the release description on GitHub (English first, Vietnamese below) and the in-app *Changelog*, shown in the app's language.

Groups to use: `### ✨ New features`, `### 🔧 Improvements`, `### 🐛 Bug fixes`.

## [Unreleased]

### ✨ New features
- **Catch copied links.** Copy a link to a file (zip, exe, mp4, pdf…) anywhere and the app asks whether to download it. Video page links (YouTube, TikTok…) can be included too. *Settings → Automation*.
- **Sort files into folders by type.** Videos, music, archives, documents, programs and images go to their own folders inside the download folder (names or full paths can be changed). Off by default; turn it on in *Settings → Automation*.
- **When done: sleep, shut down or quit.** Pick it with the new **When done** button above the download list. It runs once the last download finishes, after a 60-second countdown you can cancel, and is not kept when the app closes.
- **Unpack .zip files** automatically when they finish, into a folder next to the zip. *Settings → Automation*.

### 🔧 Improvements
- **The extension follows the app's language.** Switch between English and Vietnamese in the app (*Settings → Appearance → Language*) and the extension's popup, options page, "Download video" button and right-click menu switch too, within a few seconds, whatever language the browser uses.

## [0.5.2] - 2026-11-26

### ✨ New features
- **English interface.** The app, the tray menu and the extension are now available in English. The app follows the system language; change it in *Settings → Appearance → Language*. The extension follows the browser's language.

### 🔧 Improvements
- **A smaller "Download video" button** with a frosted-glass look: just a small icon in the corner of the video, with the label appearing on hover.
- **Redesigned extension options page and popup.** File extensions are grouped (archives, programs, video, audio, documents); click to turn a single extension or a whole group on or off. Quick size thresholds. Every change is saved right away.

### 🐛 Bug fixes
- YouTube home page: after hovering over several videos and stopping on one, the download button did not appear. It now shows for the video being previewed.
- Chrome/Edge: downloads from Google Drive (and from any site when "Ask where to save each file" is on) still showed the browser's save dialog, or the browser finished its own copy while the app downloaded the file again. The download is now handed to the app before the browser asks or downloads anything.

## [0.5.1] - 2026-11-24

### 🔧 Improvements
- **The extension updates itself, no reload needed.** When the app ships a new extension, the extension loads it within about 30 seconds while the browser is open. No more clicking ↻ on the extensions page. The first update to this version (from extension 0.4.x or 0.5.0) happens when you open any web page or click the extension icon.

## [0.5.0] - 2026-11-24

### ✨ New features
- **Start with the system.** Turn it on in *Settings → Appearance*. The app starts when you sign in and waits in the system tray (no window) to resume unfinished downloads and receive links from the browser. Uninstalling the app removes the startup entry.

## [0.4.4] - 2026-11-22

### 🐛 Bug fixes
- **Douyin downloads really work.** Version 0.4.3 reported *"This page needs cookies…"*, even when sent from the extension, because Douyin blocks yt-dlp. The extension now takes the H.264 video link straight from the open Douyin page, and the app downloads it over several connections. The video plays right away in Media Player. How to use: open the video on douyin.com, let it play, then click the **Download video** button on the video or "Send to app" in the popup.

## [0.4.3] - 2026-11-22

### ✨ New features
- **Douyin video downloads.** Open a video on douyin.com and click the download button on it, or "Send to app" in the extension. Douyin requires the browser's cookies, so pasting the link into the app does not work.

### 🔧 Improvements
- On Windows, videos only available in HEVC are converted to H.264 after downloading, so they play right away in Media Player without buying a codec.
- YouTube downloads now show each running connection, like file downloads: a segmented progress bar and the *Connections* table in the details panel.

## [0.4.2] - 2026-11-22

### 🔧 Improvements
- YouTube videos download over **several parallel connections** (the number of connections you chose), almost twice as fast.
- Videos are picked in H.264 when available, so they play in Windows Media Player without buying the HEVC codec.

### 🐛 Bug fixes
- "Send to app" on YouTube reported *"Video unavailable"*, while pasting the link worked. The cause was the browser's sign-in cookies; the app now only uses cookies when the site requires signing in.
- TikTok: the download button on the For You page downloaded the previous or next video, and the file had audio only. The extension now downloads the video you are watching, through that video's link.

## [0.4.1] - 2026-11-22

### ✨ New features

**▶️ Download videos from YouTube, TikTok, Facebook…**
- Paste a YouTube (videos, Shorts), TikTok, Facebook, Instagram, X, Vimeo, Dailymotion, SoundCloud, Bilibili or Twitch link into the app: it shows the thumbnail, title, channel and duration, and lets you **pick the quality** (4K, 1080p, 720p… or **MP3**) with an estimated size.
- On these sites, the extension's **Download video** button and popup send the video straight to the app.
- Pause and resume work. Video and audio are merged into MP4 (H.264/AAC preferred, so it plays everywhere).
- Uses the open-source tools **yt-dlp** and **ffmpeg**. The app downloads them on first use (about 110 MB on Windows, SHA-256 checked) and updates yt-dlp daily. Manage them in *Settings → Video*.

**📊 Statistics page**
- New sidebar entry: data downloaded per day, success rate, largest files, breakdown by file type, top sites and live speed. Pick 7 / 30 / 90 days.

**🪟 Interface**
- A new title bar in the app's style (Windows), with minimize / maximize / close buttons.
- The sidebar collapses to an icon rail (**Ctrl+B**).

## [0.4.0] - 2026-11-22

### ✨ New features

**🎬 Download videos on web pages**
- The extension finds videos on the page you are viewing: video/audio files (mp4, webm, mkv, mp3…) and **HLS** streams (`.m3u8`) used by many movie sites.
- The extension icon shows how many videos it found. Click it to see the list with quality (720p, 1080p…), duration, estimated size and a **Download** button.
- Hovering over a video shows a **Download video** button in its corner, even when the player is in an iframe or in full screen. You can turn the button off in the extension's *Options*.
- Right-click a streaming player's video → *Download with DownloadManager* also uses the stream it found.

**📺 HLS stream downloads**
- Paste an `.m3u8` link into the app or send it from the extension: the app picks the highest quality, downloads many segments in parallel and joins them into one `.ts` file (or `.mp4` for fMP4 streams). No ffmpeg needed.
- AES-128 encrypted streams are supported. **Pause and resume work**, even after closing the app: downloaded segments are kept.
- The add-link dialog shows the video's details: quality, duration, segment count, estimated size.
- Not supported yet: YouTube, Facebook, DASH streams, DRM-protected video, live streams, and HLS with separate audio. All of these show a clear error message.

**🧩 Outdated extension detection**
- The app knows which extension version each browser runs. If it is older than the one bundled with the app, the sidebar shows an **Update extension** card and the wizard explains how to update.
- From this version on, **the extension updates itself** whenever the app has a new version, with nothing to do. This one time, you need to click *Reload* on the extension (the app reminds you).

### 🔧 Improvements
- Completely redesigned extension, matching the app's style, with light/dark mode: toggle switches, a connection status card, an easy-to-edit list of file extensions, and a hidden pairing code.
- Common error messages are translated into Vietnamese (live streams, DRM, expired links…).
- macOS has two separate installers: **Apple Silicon** (`_aarch64.dmg`) and **Intel** (`_x64.dmg`), smaller than the previous universal build. In-app updates still pick the right build for each Mac.
- Faster releases: parallel builds, faster compilation, pre-warmed dependency cache.

## [0.3.1] - 2026-11-21

### 🐛 Bug fixes
- **The app did not detect the extension installed in Chrome/Edge/Cốc Cốc**: the extension paired successfully but the wizard still said "Not installed". Chromium browsers do not send the `Origin` header on GET requests from extensions. The extension now sends its own identifier (`X-DM-Extension`) and the app records the connection right away.

### 🔧 Improvements
- The "Waiting for connection" step explains how to connect right away: click the extension icon in the toolbar.
- Automated releases: `pnpm release <version>` → CI builds, attaches the installers and the extension, writes the description and publishes.

## [0.3.0] - 2026-11-21

### ✨ New features

**🔄 Automatic updates**
- The app checks for a new version at startup and every 6 hours.
- When one is available, the sidebar shows a **"New version vX"** card and a notification with a **View & update** button.
- **Update & restart** downloads the update (with a progress bar), saves the progress of unfinished downloads, installs it and reopens the app. Unfinished downloads continue by themselves.
- Every update is signed (minisign). The app only installs updates with a valid signature.
- If installing fails, downloads keep running instead of stopping.

**📜 In-app changelog**
- Click the version number at the bottom of the sidebar (or *Settings → About*) to open it.
- Versions are listed on the left, labeled **Current** / **New**. The right side shows the changes in the selected version.

## [0.2.0] - 2026-11-21

### ✨ New features
- **A completely new interface**:
  - sidebar filters by status and file type;
  - stat cards with a real-time speed chart;
  - per-connection progress bars;
  - a details panel with a connection map.
- Light / dark / system theme, right-click menu, a notification when a download finishes with an **Open file** button.
- Shortcuts: `Ctrl+N` add link, `Ctrl+F` search, `Space` pause/resume, `Delete` remove.
- **Install the extension from inside the app**:
  - the installer bundles the extension, and the extension pairs itself without typing a code;
  - the app detects the browsers on the computer (Chrome, Edge, Cốc Cốc, Brave, Opera, Vivaldi, Firefox) and opens the profile in use;
  - the app notices when the extension connects.
- The Windows installer (NSIS) is in Vietnamese, has branded images and installs for the current user, without admin rights.

### 🐛 Bug fixes
- The name of a connected browser is no longer overwritten when a request lacks it.

## [0.1.0] - 2026-11-21

### ✨ New features
- **Multi-connection downloads**:
  - files are split into segments (HTTP Range) and downloaded over 1–32 parallel connections;
  - work stealing: a connection that finishes early splits the largest remaining segment in half to help;
  - fewer connections when the server limits them (429/503);
  - a single connection when the server does not support or refuses Range.
- **Pause/resume**, even after closing the app or a crash (progress saved to SQLite); starts over if the file on the server changed.
- **Capture downloads from the browser** through a Manifest V3 extension, keeping cookies, referrer and user agent. If the app is not running, the browser downloads as usual.
- Queue, global speed limit, runs in the background in the system tray.

[Unreleased]: https://github.com/lion3993vn/DownloadManager/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.5.2
[0.5.1]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.5.1
[0.5.0]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.5.0
[0.4.4]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.4.4
[0.4.3]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.4.3
[0.4.2]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.4.2
[0.4.1]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.4.1
[0.4.0]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.4.0
[0.3.1]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.3.1
[0.3.0]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.3.0
[0.2.0]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.2.0
[0.1.0]: https://github.com/lion3993vn/DownloadManager/commits/v0.2.0

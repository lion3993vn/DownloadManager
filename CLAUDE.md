# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A cross-platform download manager: a Rust engine that downloads one file over many parallel HTTP Range connections, a Tauri 2 desktop app (React UI), and an MV3 browser extension that hands browser downloads to the app. The UI, installer and extension text are in **Vietnamese**; keep new user-facing strings in Vietnamese.

## Commands

```bash
pnpm install
pnpm tauri dev                     # run the app (Vite on :1420 + Rust backend, hot reload)
pnpm tauri build                   # release installers (Windows: NSIS .exe + .msi)
pnpm build                         # frontend only: tsc -b && vite build
pnpm pack:extension                # zip extension/ -> dist-extension/

cargo test -p dm-core                                   # all engine tests
cargo test -p dm-core --test download pause_and_resume  # one integration test
cargo test -p dm-core naming::tests                     # unit tests in one module
cargo clippy --workspace --all-targets                  # keep at 0 warnings
cargo fmt --all
cargo run --release -p dm-cli -- <URL> -c 8 -o ./out    # benchmark the engine without the UI
```

### Environment notes for this machine (Windows)
- Rust lives on `D:\Rust` (`RUSTUP_HOME=D:\Rust\rustup`, `CARGO_HOME=D:\Rust\cargo`). Its `bin` folder may not be on PATH in an already-open shell, so prefix commands with `export PATH="/d/Rust/cargo/bin:$PATH"` in Git Bash.
- The repo is inside OneDrive. Build with `CARGO_TARGET_DIR=D:\Rust\targets\DownloadManager` so OneDrive does not sync gigabytes of build output. Installers end up in `<target>/release/bundle/`.
- `tauri-plugin-single-instance` is on. If an installed copy of the app (e.g. `D:\DownloadManager\download-manager.exe`) is running, `pnpm tauri dev` just focuses that copy and exits, and the bridge port 47890 is already taken. Stop the other instance first.
- Dev and installed builds share the same data directory: `%APPDATA%\com.downloadmanager.desktop` (`downloads.db`, `browser-extension/`). Clean up any test downloads you create.
- After stopping `tauri dev`, a Vite process can keep port 1420 busy. Kill that `node …vite` process before starting again.

## Architecture

Cargo workspace members: `crates/dm-core` (engine, no Tauri dependency), `crates/dm-cli`, `src-tauri` (crate `download-manager`, lib `dm_app_lib`). The frontend lives in `src/`, the extension in `extension/`.

### Engine (`crates/dm-core`)
- **`engine.rs`** — `Engine` is a cheap-to-clone handle to `Inner`. `Inner` holds a mutex-guarded `State` (all downloads in a `BTreeMap` keyed by id, which is also queue order) plus `running` cancellation tokens.
  - `schedule()` starts `Queued` downloads up to `max_concurrent`.
  - `run_task()` decides the final status when a transfer ends.
  - `Engine::open`/`in_memory` must be called inside a Tokio runtime; the Tauri app uses `tauri::async_runtime::block_on`.
- **Status ownership rule:** only the engine (user actions in `transition()`, and `run_task`) writes `status`. A transfer only updates the fields it owns, through `Inner::commit`/`commit_quiet`, which call `merge_transfer_fields`. This is how a pause from the UI wins over a running transfer. Keep this split when adding fields.
- **`transfer.rs`** — one download: probe, plan segments, spawn N workers, report progress (every 250 ms), persist to SQLite (every 1 s), finalize by renaming `<name>.<id>.dmpart` to the final name.
  - Each segment `Seg` has two positions: `pos` (bytes received) and `flushed` (bytes written to disk). Data is buffered up to 512 KB before writing.
  - Work stealing (`Ctx::claim`) splits the largest active segment at `pos + remaining/2`. It only splits when at least `2*min_steal` bytes remain, so a split never lands inside another worker's unflushed buffer.
  - `release()` rewinds `pos` to `flushed` after an error.
  - On 429/503 (`Error::Busy`), `try_shed()` lets a worker exit while keeping at least one alive. This is how the engine adapts to servers that limit connections.
  - Servers without range support go through `single_stream_worker`. Unknown size uses the `UNKNOWN_END` sentinel. These downloads cannot resume.
- **`hls.rs`** — `DownloadKind::Hls` downloads (`.m3u8`). `transfer::run` hands these over, and also switches a `File` download to HLS when the probe returns an `mpegurl` content type.
  - A master playlist is resolved to the highest-resolution variant whose audio is muxed in. Separate audio renditions, `SAMPLE-AES`/DRM and live playlists (no `#EXT-X-ENDLIST`) are rejected with an error.
  - Segments are fetched in parallel (one per connection) into `<part>.d/NNNNN.seg` (written atomically), so a resume only fetches missing segments. A `manifest` file (segment count + duration + container) detects a changed playlist; URLs are left out because signed CDN URLs change.
  - AES-128 is decrypted (`aes` + `cbc`). `EXT-X-MAP` (fMP4) → `.mp4` with the init section first, otherwise `.ts`. No remuxing, so no ffmpeg.
  - `total_size` is an estimate until the end. `segments` are display-only buckets over that estimate; resume state lives in the segment folder.
  - Cookies are only sent to the playlist's own host (`scoped_headers`).
  - Use `storage::remove_part` (not `remove_file`) to discard partial data: it also deletes the segment folder.
- **`media.rs`**: `DownloadKind::Media` downloads video pages (YouTube, TikTok, Facebook…) through the external **yt-dlp**, plus **ffmpeg** to merge video and audio.
  - The host app supplies the tool paths with `Engine::set_media_tools` / `open_with_media_tools`. Use the latter at startup, so interrupted video downloads can resume before the app state exists.
  - A run does `yt-dlp -J` (title, chosen formats, size estimate), then `--load-info-json` into the work folder `<part>.d/`, parsing `--progress-template` lines (`[dm] …`) and `--print after_move:[dmfile] …`. Video then audio are folded into one total (`Stages`).
  - Pause and cancel kill the whole process tree (`taskkill /T`, or the Unix process group). The standalone yt-dlp re-launches itself as a child, so killing only the direct child leaves the download running.
  - `media_quality`: `"best"`, a max height (`"1080"`, the default) or `"audio"` (MP3). It maps to `-S res:H,vcodec:h264,acodec:aac --merge-output-format mp4` with `-f` preferring non-HLS, non-HEVC formats (`NO_HEVC`: Windows cannot play HEVC without a paid codec, and TikTok offers it at a higher resolution than H.264), with fallbacks to pre-muxed formats when ffmpeg is missing. On Windows, if the chosen video is still HEVC (`chosen_vcodec` + `is_hevc`), `to_h264` re-encodes it with ffmpeg (libx264, audio copied) before the move; on failure the HEVC file is kept.
  - `--extractor-args youtube:formats=dashy` turns YouTube's HTTPS formats into range fragments, so `-N` downloads them in parallel. Plain HTTPS formats on other sites use one connection; `fragmented()` decides the connection count shown. yt-dlp only prints totals, so `fragment_segments()` reads the work folder on each progress tick (`…-FragN.part` downloading, `…-FragN` done, lower numbers already appended; 10 MiB ranges) to report one segment per fragment. The details panel shows only the unfinished ones as connections.
  - Browser headers: extraction first runs with only the referrer (yt-dlp picks its own User-Agent per site). Browser cookies + User-Agent are tried only if that fails (`extract()`), because signed-in YouTube cookies make yt-dlp fail with "Video unavailable". Douyin needs this fallback: without fresh browser cookies yt-dlp fails with "Fresh cookies … are needed", so pasted Douyin links cannot work, only captures from the extension.
  - `is_media_site` (known hosts plus page subdomains like `www.`/`m.`/`vm.`; CDN hosts such as `v16-webapp-prime.tiktok.com` are raw files) makes `add`/`probe` treat a link as a video page. `probe` also tries yt-dlp on any `text/html` page when the tools are installed.
  - `tests/media.rs` runs a real YouTube pause/resume, and only when `DM_YTDLP` (+ `DM_FFMPEG`) are set. `dm-cli` reads the same variables and has a `-q` flag.
- **`http.rs`**
  - The client is deliberately `http1_only`, because HTTP/2 would multiplex all "parallel" connections onto one TCP stream.
  - Requests send `Accept-Encoding: identity`, since compression breaks byte ranges.
  - `probe()` requests `Range: bytes=0-0`. If that returns 400/403/405/416/501, it retries as a plain GET; some CDNs reject any Range header.
- **`store.rs`** — SQLite tables `downloads` and `segments`, plus a `kv` table. The app stores its own settings and connected-extension list in `kv` through `Engine::get_kv`/`set_kv`.
- **`storage.rs`** — part files are pre-sized and marked sparse on Windows (`FSCTL_SET_SPARSE`) to avoid NTFS zero-fill stalls on far-offset writes. Writes are positioned.
- Events: `EngineEvent` goes out on a `tokio::broadcast` channel (`Added`/`Updated`/`Progress`/`Removed`).

### Desktop app (`src-tauri`)
- **`lib.rs`** — setup does the following:
  - opens the engine at `app_data_dir/downloads.db`;
  - forwards engine events to the UI as `dm://event`;
  - manages `AppState`;
  - runs `extension_setup::prepare`;
  - starts the bridge and the tray.
  - On `RunEvent::Exit` it calls `engine.shutdown()`. That leaves interrupted downloads marked `downloading`, so they come back as `Queued` and resume on the next launch.
- **`commands.rs`** — the `#[tauri::command]` handlers used by the UI. Tauri converts snake_case argument names to camelCase on the JS side (`delete_file` → `deleteFile`).
- **`bridge.rs`** — an axum server on `127.0.0.1:47890` for the extension. Endpoints: `GET /api/ping`, `POST /api/pair` (the user approves in the UI), `POST /api/capture`.
  - Security: requests whose `Origin` is not an extension origin are rejected (this blocks web pages).
  - Captures require `X-DM-Token`.
  - The `X-DM-Browser` header is recorded as a connected extension, and the UI gets a `dm://extension-connected` event.
  - Captures are queued in `AppState.captures`; the UI pulls them with `take_captures` after receiving a `dm://capture` event.
  - A `kind: media` capture always goes through the confirm dialog while yt-dlp is missing, so the user can install it there.
- **`media_tools.rs`**: downloads yt-dlp (GitHub latest release, checked against `SHA2-256SUMS`) and, on Windows, the BtbN ffmpeg `gpl-shared` build (`checksums.sha256`; only `bin/` is extracted) into `app_data/tools/`.
  - On macOS and Linux it uses the system ffmpeg if there is one.
  - `yt-dlp -U` runs once a day.
  - Progress events are sent as `dm://tools-progress`.
  - Commands: `media_tools_status` / `install_media_tools` / `update_media_tools` / `remove_media_tools`.
- **`extension_setup.rs`**
  - The installer bundles `extension/` as a Tauri resource (`bundle.resources` in `tauri.conf.json`). At startup the app copies it to `app_data/browser-extension/` and writes `pairing.json` (token + port), so the unpacked extension pairs itself. `regenerate_token` rewrites that file.
  - It detects installed browsers. Chromium browsers refuse `chrome://` URLs passed on the command line, so the app launches them with `--new-window --profile-directory=<last_used from "Local State">` and the UI copies `chrome://extensions` to the clipboard. Firefox accepts `about:debugging` directly.

### Extension (`extension/`)
- Plain classic scripts, no modules and no build step. The same files run as Chrome's service worker (`importScripts("common.js")`) and as Firefox's `background.scripts`.
- `common.js` holds shared helpers, including `dmEnsurePaired()`, which adopts the token from the bundled `pairing.json`.
- Capture flow in `background.js`: on `downloads.onCreated`, pause the browser download, then POST it to the app. If the app accepts, cancel and erase the browser download; if it fails, resume it. The browser must keep working when the app is not running.
- Video detection in `media.js` (loaded before `background.js`, and only calls its functions at runtime):
  - `webRequest` responses are classified as `hls`, `video` or `audio`. Stream pieces (`.ts`, `.m4s`, DASH) and YouTube/Facebook range chunks are skipped.
  - Results are kept per tab in `storage.session`, shown as the badge count and in the popup list.
  - HLS playlists are fetched once to get quality and duration; variant playlists of a known master are hidden.
  - Captures send `kind: "hls"` so the app uses the HLS path.
- Video pages (`MEDIA_PAGES` in `media.js`: YouTube watch/shorts/embed, TikTok, X…) are sent as the page URL with `kind: "media"`. The popup lists the page first.
- Feeds keep one URL for many videos (TikTok For You, Instagram, YouTube home). `content.js` `pageCandidates(video)` returns possible page URLs, most specific first: TikTok's `xgwrapper-0-<id>` player id → `tiktok.com/@user/video/<id>`, Douyin's `data-e2e-vid` → `douyin.com/video/<id>`, then the frame URL, then links in the post holding only that video. The background keeps the first that matches `MEDIA_PAGES`. The popup and the context menu get them with the `dm-current-video` message (right-clicked or largest visible video).
- `mediaCanonical` rewrites Douyin's `?modal_id=<id>` feed URLs to `/video/<id>`, the only form yt-dlp accepts. On `MEDIA_FEED_SITES` (TikTok, Douyin, Instagram), network streams are ignored: the feeds preload neighbouring videos, and TikTok's raw files are HEVC.
- `content.js` (all frames) shows the "Tải video" button over the video under the pointer, in a closed shadow root. A `blob:` source maps to the best stream detected in that frame (`mediaForElement`). Setting: `showVideoButton`.
- `node --check` the scripts after editing; there is no build step to catch syntax errors.
- Versions:
  - Every request carries `X-DM-Version`. The app stores it in `ConnectedExtension.version`; a missing header means an extension from before version reporting.
  - The UI flags browsers whose latest extension is older than `extension_setup::bundled_version` (`outdatedExtensions` in `api.ts`) with a sidebar card and update steps in the wizard. A version change emits `dm://extension-updated`.
  - Self-update: `dmSelfUpdate()` compares the on-disk `manifest.json` (the app rewrites the folder on start) with the running version and calls `runtime.reload()` when the disk copy is newer. A `dmReloadedFor` guard prevents reload loops. It runs at boot, on page loads (at most every 5 min) and when the popup opens.
  - This only works if the version is bumped: keep `extension/manifest.json` equal to the app version (a test in `extension_setup.rs` checks it).

### Frontend (`src/`)
- `lib/api.ts` has typed wrappers for every command and event; keep it in sync with the Rust structs, which serialize as camelCase.
- `lib/useDownloads.ts` merges `progress` events into rows: live speed, ETA and `liveSegments`.
- Styling uses Tailwind v4 with semantic tokens defined as CSS variables in `index.css` (`bg-card`, `bg-panel`, `text-ink`, `text-mute`, `border-line`, `bg-brand`…).
- Theme is set as `<html data-theme>` (`lib/theme.ts`), and the `dark:` variant is redefined to match that attribute. Prefer the tokens over raw `slate-*`/`dark:` colors.
- Shared component styles are `@utility` classes: `btn-*`, `field`, `card`, `icon-btn`.
- `<main>` is a `@container`; layout breakpoints there use container queries (`@[760px]:`), because the details panel narrows the main area.
- Title bar: on Windows only, the window has no native frame (`src-tauri/tauri.windows.conf.json`). `components/Titlebar.tsx` draws it with `data-tauri-drag-region` and caption buttons, which need the `core:window:allow-*` permissions in `capabilities/default.json`. It sits at `z-[60]`, above modal backdrops. macOS and Linux keep the native bar, and the sidebar shows the logo there instead (`showBrand`).
- The sidebar collapses to a 60px icon rail (Ctrl+B, saved in `localStorage` `dm.sidebarCollapsed`).
- `view` switches between the download list and `StatsPage`. Stats are computed client-side from the current download list, so removed downloads are not counted.
- Charts (`components/charts.tsx`) are hand-written SVG that follows the dataviz specs. The `--chart` / `--chart-hover` colors in `index.css` were validated against the card surface in both themes.

### Tests
`crates/dm-core/tests/common/mod.rs` runs an in-process axum fixture server with misbehaving routes: `/file`, `/norange`, `/chunked`, `/flaky`, `/slow`, `/versioned` (+`/bump`), `/attachment`, `/limited` (429 above 2 connections), `/rangeforbidden`, and `/hls/{name}` (master, plain, AES-128, fMP4, byte-range, live, slow and extension-less playlists; tests in `tests/hls.rs`). Integration tests compare downloaded bytes exactly. New network edge cases should get a route there.

## Release / CI
- `.github/workflows/build.yml` runs on pushes to `main`, on PRs and on `v*` tags. It runs the engine tests, then a bundle matrix on tags only (Windows, macOS arm64 + x64 in parallel, Ubuntu 22.04); pushes/PRs run tests + a clippy/frontend `check` job. `warm-cache.yml` pre-builds release dependencies on main (tags can only read main caches) using `tauri-action`, and also packs the extension.
- Release with `pnpm release <x.y.z>` (`scripts/release.mjs`). It bumps all four version files (`Cargo.toml` `[workspace.package]`, `package.json`, `src-tauri/tauri.conf.json`, `extension/manifest.json`) plus `Cargo.lock`, turns `## [Unreleased]` in CHANGELOG.md into the version, commits, tags, pushes, and creates the **draft** release with the user's `gh` (the CI token cannot create releases in this repo). CI bundles every platform into that draft, then the `publish` job writes the notes (`scripts/release-notes.mjs` + `.github/release-template.md`) and publishes. Full procedure, checks and recovery steps: [docs/RELEASING.md](docs/RELEASING.md).
- Before releasing: commit new files too. The script ignores untracked files, so an un-added file silently misses the release. `## [Unreleased]` must not be empty. Bump the version for every extension change, because the extension self-update and the outdated-extension check compare versions only.
- Installer settings live under `bundle.windows.nsis` in `tauri.conf.json` (Vietnamese + English, per-user install, branded BMPs in `src-tauri/installer/`).

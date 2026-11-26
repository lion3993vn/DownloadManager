<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="Logo DownloadManager">

# DownloadManager

**Phần mềm quản lý và tăng tốc tải xuống miễn phí, mã nguồn mở cho Windows, macOS và Linux.**
Chia tệp thành nhiều luồng tải song song, tải tiếp sau khi tắt máy hay crash, tải video YouTube, TikTok, Facebook, Douyin…, và tự bắt lượt tải từ Chrome, Edge, Cốc Cốc, Firefox. Một lựa chọn thay thế IDM nhẹ, viết bằng Rust và Tauri.

[![Bản mới nhất](https://img.shields.io/github/v/release/lion3993vn/DownloadManager?label=t%E1%BA%A3i%20v%E1%BB%81&sort=semver)](https://github.com/lion3993vn/DownloadManager/releases/latest)
[![Lượt tải](https://img.shields.io/github/downloads/lion3993vn/DownloadManager/total)](https://github.com/lion3993vn/DownloadManager/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[English](README.md) · **Tiếng Việt**

[**⬇ Tải về cho Windows / macOS / Linux**](https://github.com/lion3993vn/DownloadManager/releases/latest)

</div>

## Tính năng

- **Tải đa luồng**: chia tệp thành nhiều đoạn (HTTP Range) và tải song song tối đa 32 kết nối.
- **Work-stealing**: kết nối nào xong sớm sẽ "cướp" nửa sau của đoạn còn lại lớn nhất, nên không bị kẹt ở đoạn chậm cuối cùng.
- **Tự thích nghi**: máy chủ trả 429/503 (giới hạn kết nối) → tự giảm số luồng; máy chủ không hỗ trợ / từ chối Range → tự chuyển về 1 luồng.
- **Tạm dừng / tiếp tục**, kể cả sau khi tắt app hoặc crash (tiến độ lưu SQLite mỗi giây). Nếu tệp trên máy chủ đổi (ETag/Last-Modified/kích thước) thì tải lại từ đầu.
- **Tải video** YouTube, TikTok, Facebook, Instagram, X (Twitter), Vimeo, Bilibili, Twitch, SoundCloud, Douyin và mọi trang [yt-dlp](https://github.com/yt-dlp/yt-dlp) hỗ trợ. Chọn chất lượng (4K, 1080p, 720p…) hoặc chỉ lấy MP3. yt-dlp và ffmpeg được cài ngay trong app bằng một cú bấm.
- **Luồng HLS / m3u8** tải song song, hỗ trợ cả mã hóa AES-128 và fMP4, không cần ffmpeg.
- **Bắt download từ trình duyệt** qua extension Chrome / Edge / Cốc Cốc / Brave / Opera / Vivaldi / Firefox, giữ nguyên cookie, referrer, user-agent; nút "Tải video" ngay trên trang xem video.
- Hàng đợi, giới hạn tốc độ toàn cục, trang thống kê, giao diện sáng/tối, chạy nền ở khay hệ thống, khởi động cùng hệ thống.
- Giao diện tiếng Việt và tiếng Anh (theo ngôn ngữ hệ thống; đổi trong *Cài đặt → Giao diện*).

## Cài đặt

Tải bộ cài từ [GitHub Releases](https://github.com/lion3993vn/DownloadManager/releases/latest) (hoặc tự build bằng `pnpm tauri build`):

- **Windows**: `DownloadManager_x.y.z_x64-setup.exe` (khuyên dùng, cài cho người dùng hiện tại, không cần quyền admin) hoặc `.msi`.
- **macOS**: `.dmg` · **Linux**: `.deb` / `.AppImage`.

Bộ cài đã kèm sẵn extension trình duyệt. App tự kiểm tra bản mới lúc khởi động và mỗi 6 giờ; chỉ cần bấm **Cập nhật & khởi động lại**, lượt tải đang dở sẽ tự tiếp tục.

## Kết nối trình duyệt (cài extension ngay trong app)

Mở app → **Kết nối trình duyệt** (thẻ ở góc dưới sidebar, hoặc tự mở ở lần chạy đầu). App sẽ:

1. Giải nén extension ra thư mục cố định và **tự ghi mã ghép cặp vào extension** → không phải nhập mã.
2. Phát hiện các trình duyệt có trên máy (Chrome, Edge, Cốc Cốc, Brave, Opera, Vivaldi, Firefox).
3. Bấm **Mở <trình duyệt>**: mở cửa sổ mới ở profile dùng gần nhất và chép sẵn địa chỉ `chrome://extensions` → dán vào thanh địa chỉ.
4. Bật *Developer mode* → *Load unpacked* → dán đường dẫn thư mục (nút **Chép** trong app).
5. App tự nhận biết khi extension kết nối thành công.

> Vì sao không cài tự động hoàn toàn? Chrome/Edge chặn phần mềm bên ngoài cài extension không có trên Store (và chặn mở `chrome://` từ dòng lệnh); Firefox bắt buộc extension được Mozilla ký. Muốn cài 1 chạm cần đăng extension lên Chrome Web Store / Edge Add-ons / AMO.

Extension bắt các tệp theo đuôi (zip, exe, iso, mp4, pdf, …) hoặc lớn hơn 20 MB (chỉnh trong tùy chọn extension). Chuột phải vào liên kết → *Tải bằng DownloadManager* để tải bất kỳ link nào.

## Kiến trúc

```
crates/dm-core   Engine Rust thuần (tokio + reqwest): probe, chia đoạn, worker, work-stealing,
                 resume, rate-limit, HLS, yt-dlp, SQLite. Không phụ thuộc Tauri.
crates/dm-cli    CLI để test/benchmark engine.
src-tauri        App Tauri 2: commands cho UI, cầu nối HTTP cho extension (127.0.0.1:47890), tray.
src              Giao diện React + TypeScript + Tailwind.
extension        Extension Manifest V3 (dùng chung Chromium + Firefox).
```

Luồng bắt download:

```
Trình duyệt ──downloads.onCreated──▶ extension ──POST /api/capture (X-DM-Token)──▶ app
                 (tạm dừng tải)          │                                        │
                                         └─ app không chạy → trình duyệt tải tiếp   └─ hộp thoại xác nhận → engine
```

Bảo mật cầu nối: chỉ bind `127.0.0.1`; request có `Origin` của trang web bị chặn (403); bắt tải cần mã ghép cặp (401 nếu sai). Ghép cặp tự động yêu cầu người dùng bấm "Cho phép" trong app.

## Phát triển

Yêu cầu: Rust stable, Node 22+, pnpm 10. Windows cần MSVC C++ build tools + WebView2; Linux cần `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev`.

```bash
pnpm install
pnpm tauri dev          # chạy app
cargo test -p dm-core   # test engine (server giả lập: Range, không Range, ngắt kết nối, 429, đổi ETag…)
pnpm tauri build        # tạo bộ cài (.msi/.exe, .dmg, .deb/.AppImage)
pnpm pack:extension     # đóng gói extension → dist-extension/*.zip
```

CLI benchmark:

```bash
cargo run --release -p dm-cli -- https://example.com/big.iso -c 8 -o ./out
```

> Mẹo (Windows + OneDrive): đặt `CARGO_TARGET_DIR` ra ngoài thư mục đồng bộ để OneDrive không phải sync vài GB file build.

Bản dịch giao diện nằm ở [`src/i18n/messages/`](src/i18n/messages) (tiếng Việt và tiếng Anh đặt cạnh nhau, TypeScript báo lỗi nếu thiếu bản dịch) và [`extension/_locales/`](extension/_locales). Ký cập nhật và phát hành phiên bản: xem [README tiếng Anh](README.md#signed-updates) và [docs/RELEASING.md](docs/RELEASING.md).

## Giới hạn hiện tại

- Chưa hỗ trợ: danh sách phát và luồng phát trực tiếp trên các trang video, HLS tách riêng tiếng/hình khi không qua yt-dlp, video có DRM, FTP/BitTorrent.
- Không bắt download trong cửa sổ ẩn danh.
- Firefox chỉ cài được extension dạng tạm thời (tự gỡ khi đóng Firefox) cho tới khi extension được Mozilla ký.
- Tải theo kiểu một luồng (máy chủ không hỗ trợ Range) không tạm dừng/tiếp tục được — tiếp tục sẽ tải lại từ đầu.

## Giấy phép

[MIT](LICENSE)

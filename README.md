# DownloadManager

Trình quản lý tải xuống đa nền tảng (Windows / macOS / Linux) kiểu IDM:

- **Tải đa luồng**: chia tệp thành nhiều đoạn (HTTP Range) và tải song song tối đa 32 kết nối.
- **Work-stealing**: kết nối nào xong sớm sẽ "cướp" nửa sau của đoạn còn lại lớn nhất, nên không bị kẹt ở đoạn chậm cuối cùng.
- **Tự thích nghi**: máy chủ trả 429/503 (giới hạn kết nối) → tự giảm số luồng; máy chủ không hỗ trợ / từ chối Range → tự chuyển về 1 luồng.
- **Tạm dừng / tiếp tục**, kể cả sau khi tắt app hoặc crash (tiến độ lưu SQLite mỗi giây). Nếu tệp trên máy chủ đổi (ETag/Last-Modified/kích thước) thì tải lại từ đầu.
- **Bắt download từ trình duyệt** qua extension Chrome / Edge / Firefox, giữ nguyên cookie, referrer, user-agent.
- Hàng đợi, giới hạn tốc độ toàn cục, chạy nền ở khay hệ thống.

## Kiến trúc

```
crates/dm-core   Engine Rust thuần (tokio + reqwest): probe, chia đoạn, worker, work-stealing,
                 resume, rate-limit, SQLite. Không phụ thuộc Tauri.
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

## Cài extension

1. **Chrome / Edge**: mở `chrome://extensions` (hoặc `edge://extensions`) → bật *Developer mode* → *Load unpacked* → chọn thư mục `extension/`.
2. **Firefox**: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → chọn `extension/manifest.json` (bản cố định cần ký qua AMO).
3. Mở app, bấm biểu tượng extension → **Kết nối với app** → bấm **Cho phép** trong app. (Hoặc dán mã từ *Cài đặt → Trình duyệt* vào trang tùy chọn của extension.)

Extension bắt các tệp theo đuôi (zip, exe, iso, mp4, pdf, …) hoặc lớn hơn 20 MB (chỉnh trong tùy chọn). Chuột phải vào liên kết → *Tải bằng DownloadManager* để tải bất kỳ link nào.

## Giới hạn hiện tại

- Chưa bắt video stream (HLS/DASH m3u8), chưa hỗ trợ FTP/BitTorrent.
- Không bắt download trong cửa sổ ẩn danh.
- Tải theo kiểu một luồng (máy chủ không hỗ trợ Range) không tạm dừng/tiếp tục được — tiếp tục sẽ tải lại từ đầu.

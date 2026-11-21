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
pnpm tauri build        # tạo bộ cài (.msi/.exe, .dmg, .deb/.AppImage) — cần khoá ký, xem bên dưới
pnpm pack:extension     # đóng gói extension → dist-extension/*.zip
```

CLI benchmark:

```bash
cargo run --release -p dm-cli -- https://example.com/big.iso -c 8 -o ./out
```

> Mẹo (Windows + OneDrive): đặt `CARGO_TARGET_DIR` ra ngoài thư mục đồng bộ để OneDrive không phải sync vài GB file build.

## Cài đặt

Tải bộ cài từ GitHub Releases (hoặc tự build bằng `pnpm tauri build`):

- **Windows**: `DownloadManager_x.y.z_x64-setup.exe` (khuyên dùng, giao diện tiếng Việt, cài cho người dùng hiện tại, không cần quyền admin) hoặc `.msi`.
- **macOS**: `.dmg` · **Linux**: `.deb` / `.AppImage`.

Bộ cài đã kèm sẵn extension trình duyệt.

## Kết nối trình duyệt (cài extension ngay trong app)

Mở app → **Kết nối trình duyệt** (thẻ ở góc dưới sidebar, hoặc tự mở ở lần chạy đầu). App sẽ:

1. Giải nén extension ra thư mục cố định và **tự ghi mã ghép cặp vào extension** → không phải nhập mã.
2. Phát hiện các trình duyệt có trên máy (Chrome, Edge, Cốc Cốc, Brave, Opera, Vivaldi, Firefox).
3. Bấm **Mở <trình duyệt>**: mở cửa sổ mới ở profile dùng gần nhất và chép sẵn địa chỉ `chrome://extensions` → dán vào thanh địa chỉ.
4. Bật *Developer mode* → *Load unpacked* → dán đường dẫn thư mục (nút **Chép** trong app).
5. App tự nhận biết khi extension kết nối thành công.

> Vì sao không cài tự động hoàn toàn? Chrome/Edge chặn phần mềm bên ngoài cài extension không có trên Store (và chặn mở `chrome://` từ dòng lệnh); Firefox bắt buộc extension được Mozilla ký. Muốn cài 1 chạm cần đăng extension lên Chrome Web Store / Edge Add-ons / AMO.

Extension bắt các tệp theo đuôi (zip, exe, iso, mp4, pdf, …) hoặc lớn hơn 20 MB (chỉnh trong tùy chọn extension). Chuột phải vào liên kết → *Tải bằng DownloadManager* để tải bất kỳ link nào.

## Cập nhật tự động & nhật ký thay đổi

Bấm số phiên bản ở góc dưới sidebar (hoặc *Cài đặt → Giới thiệu*) để xem nhật ký thay đổi của mọi phiên bản (lấy từ GitHub Releases). App tự kiểm tra bản mới lúc khởi động và mỗi 6 giờ. Khi có bản mới, chỉ cần bấm **Cập nhật & khởi động lại**. Lượt tải đang dở sẽ tự tiếp tục sau khi khởi động lại.

Bản cập nhật được ký bằng minisign và app chỉ cài bản có chữ ký khớp với public key trong `tauri.conf.json` (`plugins.updater`). Để build:

- **CI**: secret `TAURI_SIGNING_PRIVATE_KEY` của repo chứa private key. Mỗi tag `v*` tạo release kèm file `.sig` và `latest.json` (endpoint updater: `releases/latest/download/latest.json`).
- **Local**: `TAURI_SIGNING_PRIVATE_KEY=<đường dẫn hoặc nội dung key> TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" pnpm tauri build`.
- **Đừng làm mất private key.** Mất key thì các bản đã cài không nhận được cập nhật nữa.

## Phát hành phiên bản mới

1. Trong lúc làm, ghi thay đổi vào mục `## [Unreleased]` của [CHANGELOG.md](CHANGELOG.md) (nhóm `### ✨ Tính năng mới` / `### 🔧 Cải tiến` / `### 🐛 Sửa lỗi`).
2. Chạy `pnpm release 0.4.0` (thêm `--dry-run` để xem trước). Script sẽ:
   - kiểm tra đang ở `main` và không còn thay đổi chưa commit;
   - nâng version ở `Cargo.toml`, `package.json`, `tauri.conf.json`, `extension/manifest.json`;
   - chuyển `[Unreleased]` thành `[0.4.0]`;
   - commit, tạo tag `v0.4.0` và push.
3. CI tự làm phần còn lại:
   - build Windows/macOS/Linux, ký các bản cập nhật;
   - đính kèm bộ cài, extension và `latest.json`;
   - ghép mô tả release từ changelog + [mẫu](.github/release-template.md) (bảng tải về, lưu ý, SHA-256);
   - **publish**.

   Các app đang chạy sẽ thấy bản mới trong vòng 6 giờ, hoặc ngay khi khởi động lại.

## Giới hạn hiện tại

- Chưa bắt video stream (HLS/DASH m3u8), chưa hỗ trợ FTP/BitTorrent.
- Không bắt download trong cửa sổ ẩn danh.
- Firefox chỉ cài được extension dạng tạm thời (tự gỡ khi đóng Firefox) cho tới khi extension được Mozilla ký.
- Tải theo kiểu một luồng (máy chủ không hỗ trợ Range) không tạm dừng/tiếp tục được — tiếp tục sẽ tải lại từ đầu.

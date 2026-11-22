# Nhật ký thay đổi

Mọi thay đổi đáng chú ý của DownloadManager được ghi ở đây. Ghi thay đổi mới vào mục **[Unreleased]**. Khi chạy `pnpm release <version>`, mục này được đổi thành phiên bản mới, và nội dung của nó trở thành mô tả của bản phát hành trên GitHub (kèm theo trong app ở mục *Nhật ký thay đổi*).

Các nhóm nên dùng: `### ✨ Tính năng mới`, `### 🔧 Cải tiến`, `### 🐛 Sửa lỗi`.

## [Unreleased]

### ✨ Tính năng mới

**🎬 Tải video trên trang web**
- Extension tự tìm video trên trang đang xem: tệp video/âm thanh (mp4, webm, mkv, mp3…) và luồng **HLS** (`.m3u8`) mà nhiều trang phim dùng.
- Biểu tượng extension hiện số video tìm được. Bấm vào để xem danh sách kèm chất lượng (720p, 1080p…), thời lượng, dung lượng ước tính và nút **Tải**.
- Rê chuột vào video sẽ hiện nút **Tải video** ở góc, kể cả khi trình phát nằm trong iframe hay đang xem toàn màn hình. Có thể tắt nút này trong *Tùy chọn* của extension.
- Chuột phải vào video của trình phát streaming → *Tải bằng DownloadManager* cũng dùng luồng đã tìm thấy.

**📺 Tải luồng HLS**
- Dán link `.m3u8` vào app hoặc gửi từ extension: app tự chọn chất lượng cao nhất, tải song song nhiều đoạn rồi ghép thành một tệp `.ts` (hoặc `.mp4` với luồng fMP4). Không cần cài thêm ffmpeg.
- Hỗ trợ luồng mã hóa AES-128. **Tạm dừng / tiếp tục được**, kể cả sau khi tắt app: các đoạn đã tải được giữ lại.
- Hộp thoại thêm link hiện thông tin video: chất lượng, thời lượng, số đoạn, dung lượng ước tính.
- Chưa hỗ trợ: YouTube, Facebook, luồng DASH, video có DRM, luồng phát trực tiếp, và HLS tách riêng tiếng/hình. Các trường hợp này đều có thông báo lỗi rõ ràng.

**🧩 Nhận diện extension bản cũ**
- App biết extension trên từng trình duyệt đang ở phiên bản nào. Nếu cũ hơn bản đi kèm app, sidebar hiện thẻ **Cập nhật extension** và trình hướng dẫn chỉ cách cập nhật.
- Từ bản này trở đi, **extension tự cập nhật** mỗi khi app có bản mới, không cần làm gì. Riêng lần này cần bấm *Tải lại* extension một lần (app sẽ nhắc).

### 🔧 Cải tiến
- Giao diện extension làm lại hoàn toàn, cùng phong cách với app, có chế độ sáng/tối: công tắc gạt, thẻ trạng thái kết nối, danh sách đuôi tệp dạng nhãn dễ thêm/xóa, mã ghép cặp được che.
- Thông báo lỗi thường gặp được dịch sang tiếng Việt (luồng trực tiếp, DRM, liên kết hết hạn…).
- macOS có 2 bộ cài riêng: **Apple Silicon** (`_aarch64.dmg`) và **Intel** (`_x64.dmg`), nhỏ hơn bản universal trước đây. App tự cập nhật vẫn tải đúng bản cho từng máy.
- Phát hành nhanh hơn: build song song, tối ưu thời gian biên dịch, cache thư viện được làm nóng sẵn.

## [0.3.1] - 2026-11-21

### 🐛 Sửa lỗi
- **App không nhận ra extension đã cài trên Chrome/Edge/Cốc Cốc**: extension đã ghép cặp thành công nhưng trình hướng dẫn vẫn báo "Chưa cài". Nguyên nhân là trình duyệt nhân Chromium không gửi header `Origin` cho request GET từ extension. Nay extension gửi kèm định danh của mình (`X-DM-Extension`) và app ghi nhận kết nối ngay.

### 🔧 Cải tiến
- Bước "Chờ kết nối" có hướng dẫn: bấm biểu tượng extension trên thanh công cụ để kết nối ngay.
- Tự động hoá phát hành: `pnpm release <version>` → CI build, đính kèm bộ cài và extension, viết mô tả rồi publish.

## [0.3.0] - 2026-11-21

### ✨ Tính năng mới

**🔄 Tự cập nhật**
- App tự kiểm tra phiên bản mới lúc khởi động và mỗi 6 giờ.
- Khi có bản mới, sidebar hiện thẻ **"Có bản mới vX"** và có thông báo kèm nút **Xem & cập nhật**.
- Nút **Cập nhật & khởi động lại** tải bản cập nhật (có thanh tiến độ), lưu tiến độ các lượt tải đang dở, cài đặt rồi mở lại app. Lượt tải dở tự chạy tiếp.
- Mọi bản cập nhật đều được ký số (minisign). App chỉ cài bản có chữ ký hợp lệ.
- Nếu cài thất bại, các lượt tải vẫn tiếp tục chạy chứ không bị dừng.

**📜 Nhật ký thay đổi trong app**
- Bấm số phiên bản ở góc dưới sidebar (hoặc *Cài đặt → Giới thiệu*) để mở.
- Danh sách phiên bản nằm bên trái, có nhãn **Đang dùng** / **Mới**. Bên phải là chi tiết thay đổi của phiên bản đang chọn.

## [0.2.0] - 2026-11-21

### ✨ Tính năng mới
- **Giao diện mới hoàn toàn**:
  - sidebar lọc theo trạng thái và loại tệp;
  - thẻ thống kê với biểu đồ tốc độ thời gian thực;
  - thanh tiến độ theo từng luồng;
  - panel chi tiết có bản đồ luồng tải.
- Chế độ sáng / tối / theo hệ thống, menu chuột phải, thông báo khi tải xong kèm nút **Mở tệp**.
- Phím tắt: `Ctrl+N` thêm link, `Ctrl+F` tìm kiếm, `Space` tạm dừng/tiếp tục, `Delete` xóa.
- **Cài extension ngay trong app**:
  - bộ cài kèm sẵn extension, và extension tự ghép cặp mà không cần nhập mã;
  - app phát hiện trình duyệt có trên máy (Chrome, Edge, Cốc Cốc, Brave, Opera, Vivaldi, Firefox) và mở đúng profile đang dùng;
  - app tự nhận biết khi extension kết nối thành công.
- Bộ cài Windows (NSIS) có tiếng Việt, ảnh thương hiệu và cài cho người dùng hiện tại, không cần quyền admin.

### 🐛 Sửa lỗi
- Tên trình duyệt đã kết nối không còn bị ghi đè khi request thiếu thông tin.

## [0.1.0] - 2026-11-21

### ✨ Tính năng mới
- **Tải đa luồng**:
  - chia tệp thành nhiều đoạn (HTTP Range) và tải song song 1–32 kết nối;
  - work-stealing: luồng xong sớm sẽ chia đôi đoạn còn lại lớn nhất để giúp;
  - tự giảm số luồng khi máy chủ giới hạn (429/503);
  - tự chuyển về 1 luồng khi máy chủ không hỗ trợ hoặc từ chối Range.
- **Tạm dừng/tiếp tục**, kể cả sau khi tắt app hay crash (tiến độ lưu vào SQLite); tự tải lại từ đầu nếu tệp trên máy chủ đã đổi.
- **Bắt lượt tải từ trình duyệt** qua extension Manifest V3, giữ cookie, referrer và user-agent. Nếu app không chạy, trình duyệt vẫn tải như bình thường.
- Hàng đợi, giới hạn tốc độ toàn cục, chạy nền ở khay hệ thống.

[Unreleased]: https://github.com/lion3993vn/DownloadManager/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.3.1
[0.3.0]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.3.0
[0.2.0]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.2.0
[0.1.0]: https://github.com/lion3993vn/DownloadManager/commits/v0.2.0

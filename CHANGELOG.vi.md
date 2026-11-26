# Nhật ký thay đổi

[English](CHANGELOG.md) · **Tiếng Việt**

Mọi thay đổi đáng chú ý của DownloadManager, bản tiếng Việt. Bản tiếng Anh ([CHANGELOG.md](CHANGELOG.md)) là bản chính; hai tệp phải có cùng các phiên bản và cùng nội dung. Ghi thay đổi mới vào mục **[Unreleased]** của **cả hai tệp**. Khi chạy `pnpm release <version>`, mục này được đổi thành phiên bản mới, và nội dung của nó trở thành phần tiếng Việt trong mô tả bản phát hành trên GitHub (app hiện phần này khi giao diện là tiếng Việt, ở mục *Nhật ký thay đổi*).

Các nhóm nên dùng: `### ✨ Tính năng mới`, `### 🔧 Cải tiến`, `### 🐛 Sửa lỗi`.

## [Unreleased]

## [0.5.4] - 2026-11-26

### ✨ Tính năng mới
- **Tải theo lịch.** Chọn giờ bắt đầu (và giờ dừng nếu muốn) cùng các ngày trong tuần ở *Cài đặt → Tự động*. Đến giờ bắt đầu, các tệp đang tạm dừng (kể cả tệp "Thêm, tải sau") được tải tiếp; đến giờ dừng thì tạm dừng tất cả. Kết hợp với **Khi tải xong → Tắt máy** để tải qua đêm.
- **Dán nhiều link một lần.** Dán danh sách link (mỗi dòng một link) hoặc mẫu đánh số như `file[01-20].zip`, `anh[a-e].jpg`: hộp thoại thêm link liệt kê tất cả kèm ô chọn, mỗi link là một lượt tải.
- **Tải cả danh sách phát và kênh.** Dán link danh sách phát hoặc kênh YouTube (hoặc bấm **Tải cả danh sách phát** khi mở một video trong danh sách): chọn video, một chất lượng cho tất cả, và có thể lưu vào thư mục mang tên danh sách. Tối đa 1.000 video.

### 🐛 Sửa lỗi
- Link kênh và danh sách phát không còn bị quá thời gian khi app kiểm tra link.

## [0.5.3] - 2026-11-26

### ✨ Tính năng mới
- **Bắt link khi sao chép.** Sao chép link tới một tệp (zip, exe, mp4, pdf…) ở bất kỳ đâu là app hỏi có tải không. Có thể bật cả link trang video (YouTube, TikTok…). *Cài đặt → Tự động*.
- **Tự xếp tệp vào thư mục theo loại.** Video, nhạc, tệp nén, tài liệu, chương trình và ảnh được lưu vào thư mục riêng trong thư mục tải về (đổi được tên hoặc đường dẫn). Mặc định tắt; bật trong *Cài đặt → Tự động*.
- **Khi tải xong: cho máy ngủ, tắt máy hoặc thoát app.** Chọn ở nút **Khi tải xong** mới phía trên danh sách tải. Chạy khi lượt tải cuối cùng xong, sau 60 giây đếm ngược có thể hủy, và không được lưu khi tắt app.
- **Tự giải nén tệp .zip** khi tải xong, vào thư mục cạnh tệp zip. *Cài đặt → Tự động*.

### 🔧 Cải tiến
- **Extension dùng cùng ngôn ngữ với app.** Đổi giữa tiếng Việt và tiếng Anh trong app (*Cài đặt → Giao diện → Ngôn ngữ*) thì cửa sổ, trang tùy chọn, nút "Tải video" và menu chuột phải của extension cũng đổi theo sau vài giây, bất kể trình duyệt đang dùng ngôn ngữ nào.

## [0.5.2] - 2026-11-26

### ✨ Tính năng mới
- **Giao diện tiếng Anh.** App, menu khay hệ thống và extension có thêm tiếng Anh. App tự theo ngôn ngữ của hệ điều hành; đổi trong *Cài đặt → Giao diện → Ngôn ngữ*. Extension theo ngôn ngữ của trình duyệt.

### 🔧 Cải tiến
- **Nút "Tải video" gọn hơn**, kiểu kính mờ: chỉ là một biểu tượng nhỏ ở góc video, rê chuột vào mới hiện chữ.
- **Trang tùy chọn và cửa sổ của extension được thiết kế lại.** Đuôi tệp được chia theo nhóm (tệp nén, chương trình, video, âm thanh, tài liệu), bấm để bật/tắt từng đuôi hoặc cả nhóm. Chọn nhanh ngưỡng dung lượng. Mọi thay đổi được lưu ngay.

### 🐛 Sửa lỗi
- Trang chủ YouTube: rê qua nhiều video rồi dừng lại ở một video thì không hiện nút tải. Giờ nút hiện đúng video đang xem trước.
- Chrome/Edge: tải từ Google Drive (và mọi trang khi bật "Hỏi nơi lưu tệp") vẫn hiện hộp thoại chọn nơi lưu, hoặc trình duyệt tải xong một bản trong khi app cũng tải lại. Giờ lượt tải được chuyển sang app trước khi trình duyệt kịp hỏi hay tải.

## [0.5.1] - 2026-11-24

### 🔧 Cải tiến
- **Extension tự cập nhật, không cần bấm tải lại.** Khi app có bản extension mới, extension tự nạp bản mới trong khoảng 30 giây khi trình duyệt đang mở. Không phải vào trang tiện ích bấm nút ↻ nữa. Lần cập nhật đầu tiên lên bản này (từ extension 0.4.x hoặc 0.5.0) diễn ra khi bạn mở một trang web bất kỳ hoặc bấm biểu tượng extension.

## [0.5.0] - 2026-11-24

### ✨ Tính năng mới
- **Khởi động cùng hệ thống.** Bật trong *Cài đặt → Giao diện*. App tự chạy khi đăng nhập máy, nằm sẵn dưới khay hệ thống (không mở cửa sổ) để tiếp tục các lượt tải dở và nhận link từ trình duyệt. Gỡ cài đặt app sẽ tự xóa mục khởi động này.

## [0.4.4] - 2026-11-22

### 🐛 Sửa lỗi
- **Douyin tải được thật.** Bản 0.4.3 báo *"Trang này cần cookie…"*, kể cả khi gửi từ extension, vì Douyin chặn yt-dlp. Giờ extension lấy link video H.264 ngay từ trang Douyin đang mở, và app tải link đó bằng nhiều luồng. Video mở được ngay bằng Media Player. Cách dùng: mở video trên douyin.com, đợi video phát, rồi bấm nút **Tải video** trên video hoặc "Gửi sang app" trong popup.

## [0.4.3] - 2026-11-22

### ✨ Tính năng mới
- **Tải video Douyin.** Mở video trên douyin.com rồi bấm nút tải trên video, hoặc "Gửi sang app" trong extension. Douyin bắt buộc có cookie của trình duyệt, nên dán link trực tiếp vào app sẽ không tải được.

### 🔧 Cải tiến
- Trên Windows, video chỉ có định dạng HEVC được tự chuyển sang H.264 sau khi tải xong, nên mở được ngay bằng Media Player mà không cần mua codec.
- Tải video YouTube giờ hiện từng luồng đang chạy, giống như tải tệp: thanh tiến độ chia theo từng đoạn và bảng *Các luồng tải* trong phần chi tiết.

## [0.4.2] - 2026-11-22

### 🔧 Cải tiến
- Video YouTube tải bằng **nhiều luồng song song** (theo số kết nối đã chọn), nhanh hơn gần gấp đôi.
- Video được chọn ở định dạng H.264 khi có, để mở được bằng Media Player của Windows mà không cần mua codec HEVC.

### 🐛 Sửa lỗi
- Bấm "Gửi sang app" trên YouTube báo *"Video không còn hoặc không xem được"*, trong khi dán link thì tải được. Nguyên nhân là cookie đăng nhập của trình duyệt; giờ app chỉ dùng cookie khi trang yêu cầu đăng nhập.
- TikTok: nút tải trên trang For You tải nhầm video phía trước hoặc phía sau, và tệp tải về chỉ có tiếng. Giờ extension tải đúng video đang xem, qua link của video đó.

## [0.4.1] - 2026-11-22

### ✨ Tính năng mới

**▶️ Tải video YouTube, TikTok, Facebook…**
- Dán link YouTube (video, Shorts), TikTok, Facebook, Instagram, X, Vimeo, Dailymotion, SoundCloud, Bilibili, Twitch… vào app: hiện ảnh thu nhỏ, tiêu đề, kênh, thời lượng và cho **chọn chất lượng** (4K, 1080p, 720p… hoặc **MP3**) kèm dung lượng ước tính.
- Trên các trang này, nút **Tải video** của extension và cửa sổ extension gửi thẳng video sang app.
- Tạm dừng / tiếp tục được. Hình và tiếng được ghép thành MP4 (ưu tiên H.264/AAC để phát được ở mọi nơi).
- Dùng công cụ mã nguồn mở **yt-dlp** và **ffmpeg**. App tự tải về ở lần đầu (khoảng 110 MB trên Windows, có kiểm tra SHA-256) và tự cập nhật yt-dlp mỗi ngày. Quản lý ở *Cài đặt → Video*.

**📊 Trang Thống kê**
- Mục mới trên sidebar: dung lượng đã tải theo ngày, tỉ lệ thành công, tệp lớn nhất, theo loại tệp, các trang tải nhiều nhất và tốc độ trực tiếp. Chọn khoảng 7 / 30 / 90 ngày.

**🪟 Giao diện**
- Thanh tiêu đề mới cùng phong cách với app (Windows), có nút thu nhỏ / phóng to / đóng.
- Sidebar thu gọn được thành dải icon (**Ctrl+B**).

## [0.4.0] - 2026-11-22

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

[Unreleased]: https://github.com/lion3993vn/DownloadManager/compare/v0.5.4...HEAD
[0.5.4]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.5.4
[0.5.3]: https://github.com/lion3993vn/DownloadManager/releases/tag/v0.5.3
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

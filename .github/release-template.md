<!-- lang:en -->
## DownloadManager v{{VERSION}}

{{CHANGES_EN}}

---

### 📦 Downloads

| Platform | File |
|---|---|
{{DOWNLOADS_EN}}

The `.sig`, `.app.tar.gz` and `latest.json` files are used by automatic updates. You do not need to download them.

### ⬆️ Updating

- **From v0.3.0 or later:** the app tells you about the new version. Click **Update & restart** and you are done; unfinished downloads are kept.
- **Older versions or a new install:** download the installer above and run it (installing over the old version is fine). Your download list and settings are kept.

### ⚠️ Notes

- **The installers are not code-signed yet:**
  - Windows SmartScreen may warn you: click **More info → Run anyway**.
  - macOS: right-click the app → **Open**, or run `xattr -dr com.apple.quarantine /Applications/DownloadManager.app`.
  - In-app updates are always signed and their signature is checked.
- **Browser extension:** install it with the *Connect browser* wizard in the app, as an "unpacked" extension, since it is not in the stores yet. Firefox can only load it temporarily.
- **Linux** needs `libwebkit2gtk-4.1`; the `.deb`/`.rpm` packages install their dependencies.
<!-- /lang -->

<details>
<summary><b>🇻🇳 Tiếng Việt</b></summary>

<!-- lang:vi -->
## DownloadManager v{{VERSION}}

{{CHANGES_VI}}

---

### 📦 Tải về

| Hệ điều hành | Tệp |
|---|---|
{{DOWNLOADS_VI}}

Các tệp `.sig`, `.app.tar.gz` và `latest.json` dùng cho tính năng tự cập nhật. Bạn không cần tải chúng.

### ⬆️ Cập nhật

- **Đang dùng v0.3.0 trở lên:** app sẽ tự báo có bản mới. Bấm **Cập nhật & khởi động lại** là xong, lượt tải dở vẫn được giữ.
- **Bản cũ hơn hoặc cài mới:** tải bộ cài ở trên và cài (cài đè lên bản cũ được). Danh sách tải và cài đặt được giữ nguyên.

### ⚠️ Lưu ý

- **Bộ cài chưa được ký số (code signing):**
  - Windows SmartScreen có thể cảnh báo, bấm **More info → Run anyway**.
  - macOS: chuột phải vào app → **Open**, hoặc chạy `xattr -dr com.apple.quarantine /Applications/DownloadManager.app`.
  - Bản cập nhật trong app thì luôn được ký và kiểm tra chữ ký.
- **Extension trình duyệt:** cài qua trình hướng dẫn *Kết nối trình duyệt* trong app, kiểu "unpacked" vì chưa có trên Store. Trên Firefox chỉ cài được tạm thời.
- **Linux** cần `libwebkit2gtk-4.1`; bản `.deb`/`.rpm` tự cài phụ thuộc.
<!-- /lang -->

</details>

### 🔑 SHA-256

```
{{CHECKSUMS}}
```

**Full changelog:** [CHANGELOG.md](https://github.com/{{REPO}}/blob/v{{VERSION}}/CHANGELOG.md) · [Tiếng Việt](https://github.com/{{REPO}}/blob/v{{VERSION}}/CHANGELOG.vi.md){{COMPARE}}

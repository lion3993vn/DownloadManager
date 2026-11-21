## DownloadManager v{{VERSION}}

{{CHANGES}}

---

### 📦 Tải về

| Hệ điều hành | Tệp |
|---|---|
{{DOWNLOADS}}

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

### 🔑 SHA-256

```
{{CHECKSUMS}}
```

**Nhật ký đầy đủ:** [CHANGELOG.md](https://github.com/{{REPO}}/blob/v{{VERSION}}/CHANGELOG.md){{COMPARE}}

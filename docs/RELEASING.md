# Phát hành phiên bản mới

Mọi bản phát hành đi qua một lệnh: `pnpm release <x.y.z>`. Script nâng version, commit, gắn tag, push, tạo release nháp. CI build bộ cài cho mọi nền tảng, đính kèm, viết mô tả rồi publish. Cả quá trình mất khoảng 6 phút.

```
pnpm release 0.4.2
  ├─ kiểm tra: đang ở main, không còn thay đổi chưa commit, version mới hơn, CHANGELOG có nội dung
  ├─ nâng version ở 4 tệp + Cargo.lock, đổi [Unreleased] → [0.4.2]
  ├─ commit "release: v0.4.2", tag v0.4.2, push main + tag
  └─ gh release create v0.4.2 --draft        (tài khoản gh của bạn)

GitHub Actions (build.yml, chạy theo tag)
  ├─ test          cargo test dm-core                       ~1 phút
  ├─ bundle ×4     Windows x64, macOS arm64, macOS x64,      ~5 phút, song song
  │                Linux x64: build, ký, tải lên bản nháp
  ├─ extension     đóng gói extension/ thành .zip
  └─ publish       đính kèm extension, viết mô tả (CHANGELOG + bảng tải về + SHA-256),
                   bỏ nháp, đánh dấu Latest
```

Sau khi publish, các app đang chạy thấy bản mới trong vòng 6 giờ, hoặc ngay khi khởi động lại.

## Cần có

| | |
|---|---|
| **gh** | `gh auth status` phải báo đã đăng nhập, với quyền push vào repo. Script dùng tài khoản này để tạo release nháp, vì token của CI không được phép tạo release ở repo này. |
| **Node ≥ 20, cargo** | cargo dùng để cập nhật `Cargo.lock`. Trên máy Windows này: `export PATH="/d/Rust/cargo/bin:$PATH"` trước khi chạy. |
| **Secret `TAURI_SIGNING_PRIVATE_KEY`** | Có sẵn trên repo. CI dùng nó để ký bản cập nhật (`.sig`, `latest.json`). Mất key thì các bản đã cài không cập nhật được nữa: xem README, mục *Cập nhật tự động*. |

## Chọn số phiên bản

- **x.y.Z** (vá): chỉ sửa lỗi hoặc thay đổi nhỏ.
- **x.Y.0** (phụ): có tính năng mới.
- **X.0.0** (chính): thay đổi lớn, không tương thích với bản cũ.

Version phải giống nhau ở cả 4 tệp: `Cargo.toml` (`[workspace.package]`), `package.json`, `src-tauri/tauri.conf.json`, `extension/manifest.json`. Script tự làm việc này; đừng sửa tay. Test `extension_setup::tests` sẽ báo lỗi nếu version của extension khác version của app.

Version cũng là thứ duy nhất báo cho extension biết có bản mới. Extension chỉ tự tải lại khi `manifest.json` trên đĩa có version **lớn hơn** bản đang chạy, và app chỉ báo "extension đã cũ" theo version. Sửa extension mà không phát hành version mới thì người dùng không nhận được thay đổi.

## Trước khi phát hành

1. **Ghi CHANGELOG.** Viết các thay đổi dưới `## [Unreleased]` trong [CHANGELOG.md](../CHANGELOG.md), bằng tiếng Việt, cho người dùng đọc. Dùng các nhóm `### ✨ Tính năng mới`, `### 🔧 Cải tiến`, `### 🐛 Sửa lỗi`. Mục này trở thành mô tả release và hiện trong app ở *Nhật ký thay đổi*. Script từ chối chạy nếu mục này trống.
2. **Kiểm tra code.**
   ```bash
   cargo test --workspace
   cargo clippy --workspace --all-targets      # 0 cảnh báo
   pnpm build
   for f in extension/*.js; do node --check "$f"; done
   ```
   Nếu có đụng tới tải video, chạy thêm test yt-dlp thật (cần mạng):
   `DM_YTDLP=…/yt-dlp.exe DM_FFMPEG=…/ffmpeg.exe cargo test -p dm-core --test media`.
3. **Commit hết, kể cả tệp mới.** Script chỉ kiểm tra tệp đã có trong git (`git status --untracked-files=no`). Tệp mới chưa `git add` sẽ bị bỏ lại mà không có cảnh báo, và bản phát hành sẽ build lỗi hoặc thiếu tính năng. Chạy `git status` và đảm bảo không còn dòng `??` nào cần thiết.
4. **Đồng bộ với GitHub.** `git fetch && git status -sb` phải báo `## main...origin/main`, không `ahead` hay `behind`.
5. **Chạy thử app** nếu có thay đổi giao diện: `pnpm tauri dev`. Thoát bản app đã cài trước, nếu không lệnh này chỉ đưa bản đó lên rồi thoát (xem `CLAUDE.md`).

## Phát hành

```bash
pnpm release 0.4.2 --dry-run    # xem trước: version, các tệp sẽ sửa, nội dung release
pnpm release 0.4.2
```

## Theo dõi CI

```bash
gh run list --limit 3                                  # tìm run "build" của tag v0.4.2
gh run watch <run-id> --exit-status                    # chờ tới khi xong
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
gh release view v0.4.2 --json isDraft,assets --jq '.isDraft, .assets[].name'
```

Khi release còn là bản nháp, link có dạng `releases/tag/untagged-…`. Sau khi publish, link thành `releases/tag/v0.4.2`.

## Kiểm tra sau khi publish

- [ ] Release **không** còn là nháp, được đánh dấu *Latest*. Mô tả có bảng tải về và SHA-256.
- [ ] Có đủ tệp:
  - Windows: `_x64-setup.exe` và `_x64_en-US.msi`, cùng `.sig` của mỗi tệp.
  - macOS: `_aarch64.dmg` và `_x64.dmg`, cùng `_aarch64.app.tar.gz` và `_x64.app.tar.gz` và `.sig` của chúng.
  - Linux: `.AppImage`, `.deb`, `.rpm`, cùng `.sig`.
  - `downloadmanager-extension-<version>.zip` và `latest.json`.
- [ ] Mở một bản app cũ: thấy thẻ "Có bản mới", cập nhật và khởi động lại được, lượt tải dở vẫn còn.
- [ ] Sau khi cập nhật, extension tự tải lại lên version mới. Nếu app vẫn báo extension cũ, bấm *Tải lại* trên trang tiện ích của trình duyệt một lần.

## Khi có sự cố

**Script báo không tạo được release nháp** (gh chưa đăng nhập, mạng chập chờn…). Tag đã được push, nên tạo nháp bằng tay **trước khi** CI build xong:

```bash
gh release create v0.4.2 --draft --verify-tag --title "DownloadManager v0.4.2" \
  --notes "$(node scripts/release-notes.mjs 0.4.2 --changes-only)"
```

**Một job CI lỗi do lỗi tạm thời** (mạng, runner). Chạy lại các job lỗi; bản nháp vẫn giữ những tệp đã tải lên:

```bash
gh run rerun <run-id> --failed
```

**CI lỗi do lỗi code, hoặc phát hiện lỗi trước khi publish.** Không sửa lại tag cũ. Hãy xóa bản nháp và tag, sửa code, rồi phát hành lại, cùng số version hoặc số tiếp theo:

```bash
gh release delete v0.4.2 --yes          # xóa bản nháp (chưa có ai tải)
git push origin :refs/tags/v0.4.2       # xóa tag trên GitHub
git tag -d v0.4.2                       # xóa tag ở máy
# sửa lỗi, commit (commit "release: v0.4.2" cũ cứ để nguyên trong lịch sử)
```

Để dùng lại số `0.4.2`: đổi version ở 4 tệp về bản trước (`git revert` commit release), đưa nội dung `## [0.4.2]` trong CHANGELOG về lại `## [Unreleased]`, rồi chạy `pnpm release 0.4.2`. Cách đơn giản hơn: phát hành luôn `0.4.3`.

**Bản đã publish có lỗi.** Không xóa release đã publish, vì người dùng có thể đã cập nhật. Sửa lỗi và phát hành bản vá tiếp theo; app tự cập nhật lên bản đó.

**`Cargo.lock` không được cập nhật** (script báo "could not update Cargo.lock"). Lỗi này thường do cargo không có trong PATH. Chạy `cargo update --workspace --offline`, rồi commit với nội dung `chore: sync Cargo.lock`.

## Tệp liên quan

| Tệp | Vai trò |
|---|---|
| `scripts/release.mjs` | `pnpm release`: kiểm tra, nâng version, commit, tag, push, tạo nháp |
| `scripts/release-notes.mjs` | Tạo mô tả release từ CHANGELOG (`--changes-only`) hoặc mô tả đầy đủ (`--assets <dir>`) |
| `.github/release-template.md` | Mẫu mô tả: bảng tải về, hướng dẫn cập nhật, lưu ý |
| `.github/workflows/build.yml` | test → bundle ×4 → extension → publish |
| `.github/workflows/warm-cache.yml` | Build sẵn các thư viện trên `main`, để lần build theo tag nhanh hơn |

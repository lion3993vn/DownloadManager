const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await dmSettings();
  $("enabled").checked = s.enabled;
  $("skip").textContent = s.skipNext ? "Lần tải tới: dùng trình duyệt ✓" : "Lần tải tới dùng trình duyệt";
  const { running, paired } = await dmEnsurePaired();
  const status = $("status");
  if (!running) {
    status.textContent = "App chưa chạy — trình duyệt sẽ tự tải như bình thường.";
    status.className = "status warn";
    $("pair").hidden = true;
  } else if (!paired) {
    status.textContent = "App đang chạy nhưng chưa ghép cặp.";
    status.className = "status warn";
    $("pair").hidden = false;
  } else {
    status.textContent = "Đã kết nối với DownloadManager.";
    status.className = "status ok";
    $("pair").hidden = true;
  }
}

$("enabled").addEventListener("change", async (e) => {
  await ext.storage.local.set({ enabled: e.target.checked });
});

$("skip").addEventListener("click", async () => {
  const s = await dmSettings();
  await ext.storage.local.set({ skipNext: !s.skipNext });
  refresh();
});

$("pair").addEventListener("click", async () => {
  $("pair").disabled = true;
  $("status").textContent = "Hãy bấm “Cho phép” trong cửa sổ DownloadManager…";
  const res = await ext.runtime.sendMessage({ type: "pair" });
  $("pair").disabled = false;
  if (!res?.ok) {
    $("status").textContent = res?.error || "Ghép cặp thất bại.";
    $("status").className = "status warn";
    return;
  }
  refresh();
});

$("options").addEventListener("click", (e) => {
  e.preventDefault();
  ext.runtime.openOptionsPage();
  window.close();
});

refresh();

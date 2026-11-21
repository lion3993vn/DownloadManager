const $ = (id) => document.getElementById(id);

async function load() {
  const s = await dmSettings();
  $("token").value = s.token;
  $("port").value = s.port;
  $("enabled").checked = s.enabled;
  $("extensions").value = s.extensions;
  $("minSizeMB").value = s.minSizeMB;
  checkStatus();
}

async function checkStatus() {
  const s = await dmSettings();
  const { running, paired } = await dmEnsurePaired();
  const el = $("status");
  if (!running) {
    el.textContent = "Không thấy app DownloadManager đang chạy trên máy.";
    el.className = "status warn";
  } else if (!paired) {
    el.textContent = "App đang chạy. Mã ghép cặp chưa đúng — bấm “Ghép cặp tự động” hoặc dán mã.";
    el.className = "status warn";
  } else {
    el.textContent = "Đã kết nối.";
    el.className = "status ok";
  }
}

$("save").addEventListener("click", async () => {
  await ext.storage.local.set({
    token: $("token").value.trim(),
    port: Number($("port").value) || DM_DEFAULTS.port,
    enabled: $("enabled").checked,
    extensions: $("extensions").value.trim(),
    minSizeMB: Math.max(0, Number($("minSizeMB").value) || 0),
  });
  $("saved").textContent = "Đã lưu.";
  setTimeout(() => ($("saved").textContent = ""), 2000);
  checkStatus();
});

$("reset").addEventListener("click", async () => {
  const { token, port } = await dmSettings();
  await ext.storage.local.clear();
  await ext.storage.local.set({ token, port });
  load();
});

$("pair").addEventListener("click", async () => {
  await ext.storage.local.set({ port: Number($("port").value) || DM_DEFAULTS.port });
  $("status").textContent = "Hãy bấm “Cho phép” trong cửa sổ DownloadManager…";
  $("status").className = "status";
  const res = await ext.runtime.sendMessage({ type: "pair" });
  if (!res?.ok) {
    $("status").textContent = res?.error || "Ghép cặp thất bại.";
    $("status").className = "status warn";
    return;
  }
  load();
});

load();

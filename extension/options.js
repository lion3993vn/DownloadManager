const $ = (id) => document.getElementById(id);

let exts = [];

function setStatus(state, title, desc) {
  $("status").dataset.state = state;
  $("status-title").textContent = title;
  $("status-desc").textContent = desc;
}

function setDirty(on) {
  $("dirty").hidden = !on;
  if (on) $("saved").classList.remove("show");
}

// ---------- File-extension chips ----------

function normalizeExt(raw) {
  return raw.trim().replace(/^\*?\./, "").toLowerCase();
}

function renderChips() {
  const box = $("chips");
  box.querySelectorAll(".chip").forEach((c) => c.remove());
  const input = $("ext-input");
  for (const e of exts) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = e;
    const x = document.createElement("button");
    x.type = "button";
    x.title = `Bỏ .${e}`;
    x.innerHTML = '<svg class="i" viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    x.addEventListener("click", () => {
      exts = exts.filter((v) => v !== e);
      renderChips();
      setDirty(true);
    });
    chip.append(x);
    box.insertBefore(chip, input);
  }
  $("ext-count").textContent = exts.length ? `(${exts.length})` : "";
}

function addExts(text) {
  let added = false;
  for (const part of text.split(/[\s,;]+/)) {
    const e = normalizeExt(part);
    if (e && !exts.includes(e)) {
      exts.push(e);
      added = true;
    }
  }
  if (added) {
    renderChips();
    setDirty(true);
  }
}

$("chips").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) $("ext-input").focus();
});

$("ext-input").addEventListener("keydown", (e) => {
  const input = e.target;
  if (e.key === "Enter" || e.key === " " || e.key === ",") {
    e.preventDefault();
    addExts(input.value);
    input.value = "";
  } else if (e.key === "Backspace" && !input.value && exts.length) {
    exts.pop();
    renderChips();
    setDirty(true);
  }
});

$("ext-input").addEventListener("paste", (e) => {
  e.preventDefault();
  addExts(e.clipboardData.getData("text"));
});

$("ext-input").addEventListener("blur", (e) => {
  if (e.target.value.trim()) {
    addExts(e.target.value);
    e.target.value = "";
  }
});

// ---------- Load / save ----------

async function load() {
  const s = await dmSettings();
  $("token").value = s.token;
  $("port").value = s.port;
  $("enabled").checked = s.enabled;
  $("showVideoButton").checked = s.showVideoButton;
  $("minSizeMB").value = s.minSizeMB;
  exts = s.extensions.split(/\s+/).map(normalizeExt).filter(Boolean);
  renderChips();
  setDirty(false);
  checkStatus();
}

async function checkStatus() {
  setStatus("checking", "Đang kiểm tra…", "Đang tìm app DownloadManager trên máy.");
  const { running, paired, settings } = await dmEnsurePaired();
  // dmEnsurePaired may have adopted the bundled token; show it unless the user is editing.
  if ($("dirty").hidden) {
    $("token").value = settings.token;
    $("port").value = settings.port;
  }
  if (!running) {
    setStatus("warn", "Không thấy app đang chạy", "Mở DownloadManager rồi tải lại trang này.");
    $("pair").hidden = true;
  } else if (!paired) {
    setStatus("warn", "Mã ghép cặp chưa đúng", "Bấm “Ghép cặp tự động” hoặc dán mã từ app.");
    $("pair").hidden = false;
  } else {
    setStatus("ok", "Đã kết nối", "Extension đang hoạt động cùng DownloadManager.");
    $("pair").hidden = true;
  }
}

["token", "port", "minSizeMB", "enabled", "showVideoButton"].forEach((id) =>
  $(id).addEventListener("input", () => setDirty(true)),
);

$("toggle-token").addEventListener("click", () => {
  const t = $("token");
  const show = t.type === "password";
  t.type = show ? "text" : "password";
  $("toggle-token").title = show ? "Ẩn mã" : "Hiện mã";
});

$("save").addEventListener("click", async () => {
  const pending = $("ext-input").value;
  if (pending.trim()) {
    addExts(pending);
    $("ext-input").value = "";
  }
  await ext.storage.local.set({
    token: $("token").value.trim(),
    port: Number($("port").value) || DM_DEFAULTS.port,
    enabled: $("enabled").checked,
    showVideoButton: $("showVideoButton").checked,
    extensions: exts.join(" "),
    minSizeMB: Math.max(0, Number($("minSizeMB").value) || 0),
  });
  setDirty(false);
  $("saved").classList.add("show");
  setTimeout(() => $("saved").classList.remove("show"), 2000);
  checkStatus();
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Khôi phục cài đặt bắt lượt tải về mặc định? Mã ghép cặp được giữ nguyên.")) return;
  const { token, port } = await dmSettings();
  await ext.storage.local.clear();
  await ext.storage.local.set({ token, port });
  load();
});

$("pair").addEventListener("click", async () => {
  $("pair").disabled = true;
  await ext.storage.local.set({ port: Number($("port").value) || DM_DEFAULTS.port });
  setStatus("checking", "Đang chờ xác nhận…", "Hãy bấm “Cho phép” trong cửa sổ DownloadManager.");
  const res = await ext.runtime.sendMessage({ type: "pair" });
  $("pair").disabled = false;
  if (!res?.ok) {
    setStatus("error", "Ghép cặp thất bại", res?.error || "Hãy thử lại.");
    return;
  }
  setDirty(false);
  load();
});

$("version").textContent = "v" + ext.runtime.getManifest().version;

load().finally(() => {
  void document.body.offsetWidth; // flush styles so the initial toggle state is not animated
  document.body.classList.add("ready");
});

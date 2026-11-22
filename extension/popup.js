const $ = (id) => document.getElementById(id);

function setStatus(state, title, desc) {
  $("status").dataset.state = state;
  $("status-title").textContent = title;
  $("status-desc").textContent = desc;
}

function renderSkip(on) {
  $("skip").checked = on;
  $("skip-row").classList.toggle("active-once", on);
}

const VERSION = ext.runtime.getManifest().version;
$("subtitle").textContent = `Tải đa luồng · v${VERSION}`;

function showUpdate(state, title, desc) {
  $("update").hidden = false;
  $("update").dataset.state = state;
  $("update-title").textContent = title;
  $("update-desc").textContent = desc;
}

async function refresh() {
  const s = await dmSettings();
  $("enabled").checked = s.enabled;
  renderSkip(s.skipNext);
  // Newer files on disk (the app refreshed the folder): reload into them.
  const reloadingTo = await dmSelfUpdate().catch(() => null);
  if (reloadingTo) {
    showUpdate("checking", `Đang cập nhật lên v${reloadingTo}…`, "Extension sẽ tự khởi động lại trong giây lát.");
    return;
  }
  const { running, paired, extensionVersion } = await dmEnsurePaired();
  if (extensionVersion && dmCompareVersions(extensionVersion, VERSION) > 0) {
    // The app ships a newer extension but this copy cannot reach it: it was
    // installed from another folder (or a store), so it must be reinstalled.
    showUpdate(
      "warn",
      `Extension đã cũ (v${VERSION})`,
      `App có bản v${extensionVersion}. Mở DownloadManager → Kết nối trình duyệt để cài lại.`,
    );
  }
  if (!running) {
    setStatus("warn", "App chưa chạy", "Trình duyệt sẽ tự tải như bình thường.");
    $("pair").hidden = true;
  } else if (!paired) {
    setStatus("warn", "Chưa ghép cặp", "App đang chạy, bấm nút bên dưới để kết nối.");
    $("pair").hidden = false;
  } else {
    setStatus("ok", "Đã kết nối", "Lượt tải phù hợp sẽ được chuyển sang app.");
    $("pair").hidden = true;
  }
}

$("enabled").addEventListener("change", async (e) => {
  await ext.storage.local.set({ enabled: e.target.checked });
});

$("skip").addEventListener("change", async (e) => {
  await ext.storage.local.set({ skipNext: e.target.checked });
  renderSkip(e.target.checked);
});

$("pair").addEventListener("click", async () => {
  $("pair").disabled = true;
  setStatus("checking", "Đang chờ xác nhận…", "Hãy bấm “Cho phép” trong cửa sổ DownloadManager.");
  const res = await ext.runtime.sendMessage({ type: "pair" });
  $("pair").disabled = false;
  if (!res?.ok) {
    setStatus("error", "Ghép cặp thất bại", res?.error || "Hãy thử lại.");
    return;
  }
  refresh();
});

// ---------- Videos found on the current tab ----------

const ICONS = {
  hls: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
  video: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
};

let tabId = null;
let lastJson = "";
/** id -> "busy" | "ok" | "err", survives re-renders while the popup is open. */
const sendState = new Map();

function formatBytes(n) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(secs) {
  if (!secs) return "";
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderMedia(items) {
  const list = $("media-list");
  list.replaceChildren();
  $("media-empty").hidden = items.length > 0;
  $("media-count").hidden = items.length === 0;
  $("media-count").textContent = items.length;
  // Newest first: the video the user just started is usually what they want.
  for (const item of [...items].reverse()) {
    const li = el("li", "media-item");
    const icon = el("span", `media-icon ${item.type}`);
    icon.innerHTML = `<svg class="i" viewBox="0 0 24 24">${ICONS[item.type] || ICONS.video}</svg>`;

    const text = el("div", "media-text");
    const title =
      item.type === "hls"
        ? `Video HLS${item.resolution ? ` · ${Math.min(...item.resolution)}p` : ""}`
        : item.urlName || item.label;
    const t = el("div", "media-title", title);
    t.title = item.url;
    const meta = [];
    if (item.type !== "hls") meta.push(item.label);
    if (item.duration && !item.live) meta.push(formatDuration(item.duration));
    if (item.size) meta.push((item.type === "hls" ? "≈ " : "") + formatBytes(item.size));
    meta.push(hostOf(item.url));
    const m = el("div", "media-meta", meta.filter(Boolean).join(" · "));
    if (item.problem) m.prepend(el("span", "media-problem", item.problem));
    text.append(t, m);

    const state = sendState.get(item.id);
    const btn = el("button", "btn btn-primary btn-sm");
    btn.textContent = state === "busy" ? "…" : state === "ok" ? "✓ Đã gửi" : state === "err" ? "Thử lại" : "Tải";
    if (state === "ok") btn.className = "btn btn-sm btn-done";
    btn.disabled = Boolean(item.problem) || state === "busy";
    btn.addEventListener("click", () => download(item));

    li.append(icon, text, btn);
    list.append(li);
  }
}

async function refreshMedia() {
  if (tabId == null) return;
  let items = [];
  try {
    items = (await ext.runtime.sendMessage({ type: "media-list", tabId })) || [];
  } catch {
    /* background restarting */
  }
  const json = JSON.stringify(items) + JSON.stringify([...sendState]);
  if (json === lastJson) return;
  lastJson = json;
  renderMedia(items);
}

async function download(item) {
  sendState.set(item.id, "busy");
  lastJson = "";
  refreshMedia();
  const res = await ext.runtime.sendMessage({ type: "media-download", tabId, id: item.id });
  sendState.set(item.id, res && res.ok ? "ok" : "err");
  if (!(res && res.ok)) setStatus("error", "Không gửi được video", (res && res.error) || "Hãy thử lại.");
  lastJson = "";
  refreshMedia();
}

ext.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  tabId = tab ? tab.id : null;
  refreshMedia();
  // Playlist details (quality, duration) arrive a moment after detection.
  setInterval(refreshMedia, 1500);
});

$("options").addEventListener("click", () => {
  ext.runtime.openOptionsPage();
  window.close();
});

refresh().finally(() => {
  void document.body.offsetWidth; // flush styles so the initial toggle state is not animated
  document.body.classList.add("ready");
});

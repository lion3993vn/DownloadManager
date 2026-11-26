const $ = (id) => document.getElementById(id);

dmApplyI18n();
// Badge text of the "skip next" row (CSS `content: attr(data-on-label)`).
document.querySelector("#skip-row .title").dataset.onLabel = dmT("skipActive");

/**
 * Header chip (short `chip` text) always; the notice card only when something
 * needs attention.
 */
function setStatus(state, title, desc, chip) {
  $("chip").dataset.state = state;
  $("chip-text").textContent = dmT(
    chip || { ok: "chipConnected", error: "chipError", checking: "chipChecking" }[state] || "chipOffline",
  );
  $("status").dataset.state = state;
  $("status-title").textContent = title;
  $("status-desc").textContent = desc;
  $("status").hidden = state === "ok" || (state === "checking" && $("status").hidden);
}

function renderSkip(on) {
  $("skip").checked = on;
  $("skip-row").classList.toggle("active-once", on);
}

const VERSION = ext.runtime.getManifest().version;
$("subtitle").textContent = dmT("popupSubtitleVersion", VERSION);

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
    showUpdate("checking", dmT("updating", reloadingTo), dmT("updatingDesc"));
    return;
  }
  const { running, paired, extensionVersion } = await dmEnsurePaired();
  if (extensionVersion && dmCompareVersions(extensionVersion, VERSION) > 0) {
    // The app ships a newer extension but this copy cannot reach it: it was
    // installed from another folder (or a store), so it must be reinstalled.
    showUpdate(
      "warn",
      dmT("outdatedTitle", VERSION),
      dmT("outdatedDesc", extensionVersion),
    );
  }
  if (!running) {
    setStatus("warn", dmT("appNotRunning"), dmT("appNotRunningDesc"));
    $("pair").hidden = true;
  } else if (!paired) {
    setStatus("warn", dmT("notPaired"), dmT("notPairedDesc"), "chipNotPaired");
    $("pair").hidden = false;
  } else {
    setStatus("ok", dmT("connected"), dmT("connectedDesc"));
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
  setStatus("checking", dmT("pairWaiting"), dmT("pairWaitingDesc"));
  const res = await ext.runtime.sendMessage({ type: "pair" });
  $("pair").disabled = false;
  if (!res?.ok) {
    setStatus("error", dmT("pairFailed"), res?.error || dmT("tryAgain"));
    return;
  }
  refresh();
});

// ---------- Videos found on the current tab ----------

const ICONS = {
  hls: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
  page: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
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
  // The video page (YouTube…) stays on top.
  const ordered = [...items.filter((i) => i.type === "page"), ...items.filter((i) => i.type !== "page").reverse()];
  for (const item of ordered) {
    const li = el("li", "media-item");
    const icon = el("span", `tile ${item.type === "audio" ? "fuchsia" : item.type === "hls" ? "violet" : "rose"}`);
    icon.innerHTML = `<svg class="i" viewBox="0 0 24 24">${ICONS[item.type] || ICONS.video}</svg>`;

    const text = el("div", "media-text");
    const title =
      item.type === "page"
        ? dmT("mediaPageTitle", item.site)
        : item.type === "hls"
        ? `${dmT("mediaHlsTitle")}${item.resolution ? ` · ${Math.min(...item.resolution)}p` : ""}`
        : item.urlName || item.label;
    const t = el("div", "media-title", title);
    t.title = item.url;
    const meta = [];
    if (item.type === "page") meta.push(dmT("mediaPageHint"));
    else if (item.type !== "hls") meta.push(item.label);
    if (item.duration && !item.live) meta.push(formatDuration(item.duration));
    if (item.size) meta.push((item.type === "hls" ? "≈ " : "") + formatBytes(item.size));
    meta.push(hostOf(item.url));
    const m = el("div", "media-meta", meta.filter(Boolean).join(" · "));
    if (item.problem) m.prepend(el("span", "media-problem", item.problem));
    text.append(t, m);

    const state = sendState.get(item.id);
    const btn = el("button", "btn btn-primary btn-sm");
    btn.textContent =
      state === "busy" ? "…" : state === "ok" ? dmT("btnSent") : state === "err" ? dmT("btnRetry") : dmT("btnDownload");
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
  if (!(res && res.ok)) {
    // The connection itself may be fine: leave the header chip alone.
    $("status").dataset.state = "error";
    $("status-title").textContent = dmT("sendVideoFailed");
    $("status-desc").textContent = (res && res.error) || dmT("tryAgain");
    $("status").hidden = false;
  }
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

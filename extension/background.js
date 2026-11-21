// Intercepts browser downloads and hands them to the DownloadManager app.
// If the app is not running (or refuses), the browser download continues.

if (typeof importScripts === "function" && typeof DM_DEFAULTS === "undefined") {
  importScripts("common.js"); // Chrome service worker
}

const MB = 1024 * 1024;
const MENU_ID = "dm-download-link";

const MIME_EXT = {
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/x-rar-compressed": "rar",
  "application/vnd.rar": "rar",
  "application/x-7z-compressed": "7z",
  "application/gzip": "gz",
  "application/x-msdownload": "exe",
  "application/x-msi": "msi",
  "application/x-apple-diskimage": "dmg",
  "application/x-iso9660-image": "iso",
  "application/vnd.android.package-archive": "apk",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/x-matroska": "mkv",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/flac": "flac",
};

function baseName(path) {
  return (path || "").split(/[\\/]/).pop() || "";
}

function nameFromUrl(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function extOf(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function shouldCapture(item, name, s) {
  const wanted = new Set(s.extensions.toLowerCase().split(/[\s,;]+/).filter(Boolean));
  const fileExt = extOf(name) || MIME_EXT[(item.mime || "").split(";")[0]] || "";
  if (fileExt && wanted.has(fileExt)) return true;
  const size = item.totalBytes > 0 ? item.totalBytes : item.fileSize > 0 ? item.fileSize : 0;
  return s.minSizeMB > 0 && size >= s.minSizeMB * MB;
}

async function cookieHeader(url) {
  try {
    const cookies = await ext.cookies.getAll({ url });
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ") || null;
  } catch {
    return null;
  }
}

/** POST a capture to the app; resolves true if the app accepted it. */
async function sendToApp(s, { url, fileName, fileSize, mime, referrer }) {
  const payload = {
    url,
    fileName: fileName || null,
    fileSize: fileSize > 0 ? fileSize : null,
    mime: mime || null,
    referrer: referrer || null,
    userAgent: navigator.userAgent,
    cookies: await cookieHeader(url),
  };
  const post = (settings) =>
    fetch(`${dmBase(settings)}/api/capture`, {
      method: "POST",
      headers: dmHeaders(settings, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
  try {
    let res = await post(s);
    if (res.status === 401) {
      // Token changed in the app: adopt the one it wrote into pairing.json.
      const r = await dmEnsurePaired();
      if (!r.paired) return false;
      res = await post(r.settings);
    }
    return res.ok;
  } catch {
    return false;
  }
}

/** Settings with a usable token, or null if we are not paired. */
async function pairedSettings() {
  const s = await dmSettings();
  if (s.token) return s;
  const r = await dmEnsurePaired();
  return r.paired ? r.settings : null;
}

async function flashBadge(text, color) {
  try {
    await ext.action.setBadgeBackgroundColor({ color });
    await ext.action.setBadgeText({ text });
    setTimeout(() => ext.action.setBadgeText({ text: "" }), 4000);
  } catch {
    /* ignore */
  }
}

ext.downloads.onCreated.addListener(async (item) => {
  const prefs = await dmSettings();
  if (!prefs.enabled || item.incognito || item.state !== "in_progress") return;
  const url = item.finalUrl || item.url;
  if (!/^https?:\/\//i.test(url)) return; // blob:, data:, file:
  if (prefs.skipNext) {
    await ext.storage.local.set({ skipNext: false });
    return;
  }
  const name = baseName(item.filename) || nameFromUrl(url);
  if (!shouldCapture(item, name, prefs)) return;
  const s = await pairedSettings();
  if (!s) return;

  // Hold the browser download while we ask the app.
  try {
    await ext.downloads.pause(item.id);
  } catch {
    /* may already be complete */
  }
  const accepted = await sendToApp(s, {
    url,
    fileName: baseName(item.filename) || null,
    fileSize: item.totalBytes || item.fileSize,
    mime: item.mime,
    referrer: item.referrer,
  });
  if (accepted) {
    try {
      await ext.downloads.cancel(item.id);
      await ext.downloads.erase({ id: item.id });
    } catch {
      /* ignore */
    }
    flashBadge("✓", "#16a34a");
  } else {
    try {
      await ext.downloads.resume(item.id);
    } catch {
      /* ignore */
    }
  }
});

function createMenu() {
  ext.contextMenus.removeAll(() => {
    ext.contextMenus.create({
      id: MENU_ID,
      title: "Tải bằng DownloadManager",
      contexts: ["link", "video", "audio", "image"],
    });
  });
}
// Pair with the app as soon as we are installed / the browser starts, so the
// app's setup wizard can see the extension right away.
function onBoot() {
  createMenu();
  dmEnsurePaired().catch(() => {});
}
ext.runtime.onInstalled.addListener(onBoot);
ext.runtime.onStartup?.addListener(onBoot);

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const url = info.linkUrl || info.srcUrl;
  if (!url || !/^https?:\/\//i.test(url)) return;
  const s = await pairedSettings();
  if (!s) {
    ext.runtime.openOptionsPage();
    return;
  }
  const ok = await sendToApp(s, { url, referrer: info.pageUrl || tab?.url });
  flashBadge(ok ? "✓" : "!", ok ? "#16a34a" : "#dc2626");
});

// Pairing runs here (not in the popup) because the popup closes as soon as
// the user switches to the app window to approve.
ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "pair") return false;
  (async () => {
    const s = await dmSettings();
    try {
      const res = await fetch(`${dmBase(s)}/api/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browser: dmBrowserName() }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.token) {
        await ext.storage.local.set({ token: body.token });
        flashBadge("✓", "#16a34a");
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: body.error || `HTTP ${res.status}` });
      }
    } catch {
      sendResponse({ ok: false, error: "Không kết nối được tới app. Hãy mở DownloadManager." });
    }
  })();
  return true; // async response
});

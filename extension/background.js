// Intercepts browser downloads and hands them to the DownloadManager app.
// If the app is not running (or refuses), the browser download continues.

if (typeof importScripts === "function" && typeof DM_DEFAULTS === "undefined") {
  importScripts("common.js", "media.js"); // Chrome service worker
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
async function sendToApp(s, { url, fileName, fileSize, mime, referrer, kind }) {
  const payload = {
    url,
    fileName: fileName || null,
    fileSize: fileSize > 0 ? fileSize : null,
    mime: mime || null,
    kind: kind || null,
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

/** Briefly show ✓ / ! on the toolbar icon; with a tab, then restore its video count. */
async function flashBadge(text, color, tabId) {
  const scope = tabId != null ? { tabId } : {};
  try {
    await ext.action.setBadgeBackgroundColor({ ...scope, color });
    await ext.action.setBadgeText({ ...scope, text });
    setTimeout(() => {
      if (tabId != null) mediaBadge(tabId);
      else ext.action.setBadgeText({ text: "" });
    }, 4000);
  } catch {
    /* ignore */
  }
}

/**
 * Settings to send a browser download with, or null to let the browser keep
 * it. Consumes the one-shot "skip next download".
 */
async function captureSettings(item) {
  const prefs = await dmSettings();
  if (!prefs.enabled || item.incognito || item.state !== "in_progress") return null;
  const url = item.finalUrl || item.url;
  if (!/^https?:\/\//i.test(url)) return null; // blob:, data:, file:
  if (prefs.skipNext) {
    await ext.storage.local.set({ skipNext: false });
    return null;
  }
  const name = baseName(item.filename) || nameFromUrl(url);
  if (!shouldCapture(item, name, prefs)) return null;
  return pairedSettings();
}

function captureOf(item) {
  return {
    url: item.finalUrl || item.url,
    fileName: baseName(item.filename) || null,
    fileSize: item.totalBytes || item.fileSize,
    mime: item.mime,
    referrer: item.referrer,
  };
}

async function dropBrowserDownload(id) {
  try {
    await ext.downloads.cancel(id);
  } catch {
    /* already gone */
  }
  try {
    await ext.downloads.erase({ id });
  } catch {
    /* ignore */
  }
}

async function downloadState(id) {
  try {
    const [item] = await ext.downloads.search({ id });
    return item ? item.state : null;
  } catch {
    return null;
  }
}

if (ext.downloads.onDeterminingFilename) {
  // Chromium: decide before the file name is settled. Until suggest() is
  // called the browser neither shows its "Save as" dialog nor finishes the
  // file, so a small file cannot complete in the browser while the app is
  // also fetching it (Google Drive), and the app's own folder choice is the
  // only one. `item.filename` already holds the server's name here, which
  // URLs like drive.usercontent.google.com/download?id=… do not carry.
  ext.downloads.onDeterminingFilename.addListener((item, suggest) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try {
        suggest();
      } catch {
        /* download already gone */
      }
    };
    // Never hold a download for long if something below hangs.
    const guard = setTimeout(release, 15000);
    (async () => {
      const s = await captureSettings(item);
      if (!s) return release();
      const accepted = await sendToApp(s, captureOf(item));
      if (!accepted) return release();
      released = true; // the browser copy is dropped, never named
      await dropBrowserDownload(item.id);
      flashBadge("✓", "#16a34a");
    })()
      .catch(release)
      .finally(() => clearTimeout(guard));
    return true; // suggest() is called asynchronously
  });
} else {
  // Firefox has no onDeterminingFilename: hold the download while we ask.
  ext.downloads.onCreated.addListener(async (item) => {
    const s = await captureSettings(item);
    if (!s) return;
    try {
      await ext.downloads.pause(item.id);
    } catch {
      /* may already be complete */
    }
    // A small file can finish before the pause lands; the browser has it then.
    if ((await downloadState(item.id)) === "complete") return;
    const accepted = await sendToApp(s, captureOf(item));
    if (accepted) {
      await dropBrowserDownload(item.id);
      flashBadge("✓", "#16a34a");
    } else {
      try {
        await ext.downloads.resume(item.id);
      } catch {
        /* ignore */
      }
    }
  });
}

function createMenu() {
  ext.contextMenus.removeAll(() => {
    ext.contextMenus.create({
      id: MENU_ID,
      title: dmT("menuDownload"),
      contexts: ["link", "video", "audio", "image"],
    });
  });
}
// Pair with the app as soon as we are installed / the browser starts, so the
// app's setup wizard can see the extension right away.
function onBoot() {
  createMenu();
  dmEnsurePaired().catch(() => {});
  dmSelfUpdate().catch(() => {});
}

// The app may refresh the extension folder while the browser keeps running;
// check for newer files now and then (page loads wake the worker anyway).
let lastSelfUpdateCheck = 0;
ext.tabs.onUpdated.addListener((_tabId, info) => {
  if (info.status !== "complete" || Date.now() - lastSelfUpdateCheck < 5 * 60 * 1000) return;
  lastSelfUpdateCheck = Date.now();
  dmSelfUpdate().catch(() => {});
});
ext.runtime.onInstalled.addListener(onBoot);
ext.runtime.onStartup?.addListener(onBoot);

// Also check on a timer, so a new version is picked up within about 30 s of
// the app refreshing the folder, without a page load or a manual reload.
// (Browsers may round the period up; Chrome's minimum is 30 s.)
const SELF_UPDATE_ALARM = "dm-self-update";
if (ext.alarms) {
  ext.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SELF_UPDATE_ALARM) dmSelfUpdate().catch(() => {});
  });
  Promise.resolve(ext.alarms.get(SELF_UPDATE_ALARM))
    .then((a) => a || ext.alarms.create(SELF_UPDATE_ALARM, { periodInMinutes: 0.5 }))
    .catch(() => {});
}

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const url = info.linkUrl || info.srcUrl;
  const s = await pairedSettings();
  if (!s) {
    ext.runtime.openOptionsPage();
    return;
  }
  // Streaming players play from blob: URLs; use the stream found on the page.
  if (url && /^blob:/i.test(url) && tab && /^(video|audio)$/.test(info.mediaType || "")) {
    // content.js knows which post the right-clicked video belongs to.
    let pages = [info.frameUrl || info.pageUrl];
    let direct = null;
    try {
      const found = await ext.tabs.sendMessage(tab.id, { type: "dm-current-video" }, { frameId: info.frameId ?? 0 });
      if (found && Array.isArray(found.pages) && found.pages.length) pages = found.pages;
      direct = (found && found.direct) || null;
    } catch {
      /* no content script in that frame */
    }
    const item = await mediaForElement(tab.id, info.frameId ?? 0, null, pages, direct);
    if (item) mediaSend(tab.id, item);
    else flashBadge("!", "#dc2626", tab.id);
    return;
  }
  if (!url || !/^https?:\/\//i.test(url)) return;
  const ok = await sendToApp(s, { url, referrer: info.pageUrl || tab?.url });
  flashBadge(ok ? "✓" : "!", ok ? "#16a34a" : "#dc2626", tab?.id);
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
      sendResponse({ ok: false, error: dmT("errAppUnreachable") });
    }
  })();
  return true; // async response
});

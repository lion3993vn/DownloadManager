// Shared by background, popup and options. Classic script (no modules) so it
// works as a Chrome service worker import and as a Firefox background script.

/* eslint-disable no-unused-vars */
const ext = globalThis.browser ?? globalThis.chrome;

const DM_DEFAULTS = {
  enabled: true,
  token: "",
  port: 47890,
  // Captured when the file name ends with one of these.
  extensions:
    "zip rar 7z tar gz tgz bz2 xz zst iso img dmg exe msi msix apk deb rpm appimage pkg " +
    "mp4 mkv avi mov wmv flv webm m4v mp3 flac wav aac m4a ogg pdf epub",
  // Also capture anything at least this big (MB); 0 disables.
  minSizeMB: 20,
  // Show a "download" button over videos on web pages.
  showVideoButton: true,
  // Let the browser handle the next download (one-shot bypass).
  skipNext: false,
};

/**
 * Translated text from _locales/<browser language>/messages.json (English
 * otherwise). `subs` fill `$1`, `$2`… Falls back to the key.
 */
function dmT(key, ...subs) {
  try {
    return ext.i18n.getMessage(key, subs.map(String)) || key;
  } catch {
    return key;
  }
}

/**
 * Fills `data-i18n` (text), `data-i18n-html` (trusted markup from our own
 * messages), `data-i18n-title`, `data-i18n-placeholder` and
 * `data-i18n-aria-label` elements under `root`.
 */
function dmApplyI18n(root = document) {
  if (root === document) document.documentElement.lang = ext.i18n.getUILanguage();
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = dmT(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-html]")) el.innerHTML = dmT(el.dataset.i18nHtml);
  for (const el of root.querySelectorAll("[data-i18n-title]")) el.title = dmT(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = dmT(el.dataset.i18nPlaceholder);
  for (const el of root.querySelectorAll("[data-i18n-aria-label]")) {
    el.setAttribute("aria-label", dmT(el.dataset.i18nAriaLabel));
  }
}

async function dmSettings() {
  const stored = await ext.storage.local.get(null);
  return { ...DM_DEFAULTS, ...stored };
}

function dmBase(s) {
  return `http://127.0.0.1:${s.port}`;
}

function dmBrowserName() {
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/coc_coc_browser\//i.test(ua)) return "Cốc Cốc";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Vivaldi\//.test(ua)) return "Vivaldi";
  if (navigator.brave) return "Brave";
  if (/Chrome\//.test(ua)) return "Google Chrome";
  return "Trình duyệt";
}

function dmHeaders(s, extra = {}) {
  return {
    "X-DM-Token": s.token,
    "X-DM-Browser": dmBrowserName(),
    // Chromium drops the Origin header on GET requests from extensions with
    // host permissions; tell the app who we are explicitly.
    "X-DM-Extension": new URL(ext.runtime.getURL("")).origin,
    // Lets the app flag extensions older than the one it ships with.
    "X-DM-Version": ext.runtime.getManifest().version,
    ...extra,
  };
}

/** -> { running: bool, paired: bool, extensionVersion: string | null } */
async function dmPing(s) {
  try {
    const res = await fetch(`${dmBase(s)}/api/ping`, {
      headers: dmHeaders(s),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { running: false, paired: false, extensionVersion: null };
    const body = await res.json();
    return { running: true, paired: Boolean(body.paired), extensionVersion: body.extensionVersion || null };
  } catch {
    return { running: false, paired: false, extensionVersion: null };
  }
}

/**
 * When installed by the DownloadManager app, the extension folder contains a
 * pairing.json with the current token. Returns null for store/zip installs.
 */
async function dmBundledPairing() {
  try {
    const res = await fetch(ext.runtime.getURL("pairing.json"), { cache: "no-store" });
    if (!res.ok) return null;
    const p = await res.json();
    return typeof p.token === "string" && p.token ? p : null;
  } catch {
    return null;
  }
}

/** Make sure we hold a working token, adopting the bundled one if needed. */
async function dmEnsurePaired() {
  let s = await dmSettings();
  let status = await dmPing(s);
  if (status.paired) return { ...status, settings: s };
  const bundled = await dmBundledPairing();
  if (bundled && (bundled.token !== s.token || (bundled.port && bundled.port !== s.port))) {
    await ext.storage.local.set({ token: bundled.token, port: bundled.port || s.port });
    s = await dmSettings();
    status = await dmPing(s);
  }
  return { ...status, settings: s };
}

/** Compare dotted versions numerically: >0 if a is newer than b. */
function dmCompareVersions(a, b) {
  const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Version in the manifest.json on disk (may be newer than the running one). */
async function dmDiskVersion() {
  try {
    const res = await fetch(ext.runtime.getURL("manifest.json"), { cache: "no-store" });
    return res.ok ? (await res.json()).version || null : null;
  } catch {
    return null;
  }
}

/**
 * The app rewrites the unpacked extension folder with the version it ships on
 * every start. When the files on disk are newer than what is running, reload
 * to pick them up. Store installs never differ, so they never reload.
 * Returns the version being reloaded into, or null.
 */
async function dmSelfUpdate() {
  const running = ext.runtime.getManifest().version;
  const disk = await dmDiskVersion();
  if (!disk || dmCompareVersions(disk, running) <= 0) return null;
  // Guard against a reload loop if the browser keeps loading the old files.
  const { dmReloadedFor } = await ext.storage.local.get("dmReloadedFor");
  if (dmReloadedFor && dmReloadedFor.version === disk && Date.now() - dmReloadedFor.at < 10 * 60 * 1000) {
    return null;
  }
  await ext.storage.local.set({ dmReloadedFor: { version: disk, at: Date.now() } });
  setTimeout(() => ext.runtime.reload(), 300);
  return disk;
}

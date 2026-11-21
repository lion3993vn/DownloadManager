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
  // Let the browser handle the next download (one-shot bypass).
  skipNext: false,
};

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
  return { "X-DM-Token": s.token, "X-DM-Browser": dmBrowserName(), ...extra };
}

/** -> { running: bool, paired: bool } */
async function dmPing(s) {
  try {
    const res = await fetch(`${dmBase(s)}/api/ping`, {
      headers: dmHeaders(s),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { running: false, paired: false };
    const body = await res.json();
    return { running: true, paired: Boolean(body.paired) };
  } catch {
    return { running: false, paired: false };
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

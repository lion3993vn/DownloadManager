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
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  return "Trình duyệt";
}

/** -> { running: bool, paired: bool } */
async function dmPing(s) {
  try {
    const res = await fetch(`${dmBase(s)}/api/ping`, {
      headers: { "X-DM-Token": s.token },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { running: false, paired: false };
    const body = await res.json();
    return { running: true, paired: Boolean(body.paired) };
  } catch {
    return { running: false, paired: false };
  }
}

// Finds videos on pages by watching network responses: direct media files
// (mp4, webm, mp3…) and HLS playlists (.m3u8). Each tab keeps its own list,
// shown as a badge count, in the popup and behind the in-page video button.
//
// Classic script shared by Chrome's service worker (importScripts) and
// Firefox's background page. Uses sendToApp / pairedSettings / flashBadge
// from background.js at runtime only.

/* eslint-disable no-unused-vars */

const MEDIA_MAX_PER_TAB = 60;
/** Direct files smaller than this are previews, ads or thumbnails. */
const MEDIA_MIN_BYTES = 512 * 1024;
const MEDIA_TYPES = ["media", "xmlhttprequest", "other"];

const MEDIA_VIDEO_EXT = ["mp4", "m4v", "webm", "mkv", "mov", "flv", "avi", "wmv", "3gp", "ogv"];
const MEDIA_AUDIO_EXT = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "flac", "wav"];
const MEDIA_MIME_EXT = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/quicktime": "mov",
  "video/x-flv": "flv",
  "video/ogg": "ogv",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/wav": "wav",
};

function mediaHeader(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name);
  return h ? h.value || "" : "";
}

function mediaPathExt(url) {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

/**
 * Sites whose feeds preload the videos before and after the one on screen, so
 * a stream seen on the network is often not the one the user means (TikTok's
 * are also HEVC, which Windows cannot play). Their videos go through the page
 * URL and yt-dlp instead.
 */
const MEDIA_FEED_SITES = /(^|\.)(tiktok\.com|instagram\.com)$/i;

function mediaFromFeedSite(pageUrl) {
  try {
    return MEDIA_FEED_SITES.test(new URL(pageUrl).hostname);
  } catch {
    return false;
  }
}

/** -> "hls" | "video" | "audio" | null */
function mediaClassify(url, mime) {
  const ext = mediaPathExt(url);
  mime = (mime || "").split(";")[0].trim().toLowerCase();
  if (ext === "m3u8" || mime.includes("mpegurl")) return "hls";
  // Pieces of a stream, not something to download on its own.
  if (["ts", "m4s", "mpd", "aac"].includes(ext) && !mime.startsWith("audio/")) return null;
  if (mime === "video/mp2t" || mime.includes("dash+xml")) return null;
  let host = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    // YouTube / Facebook style players fetch byte ranges of split audio and
    // video tracks; those chunks are not standalone files.
    if (host.endsWith("googlevideo.com")) return null;
    if (u.searchParams.has("bytestart") || u.searchParams.has("range")) return null;
  } catch {
    return null;
  }
  if (mime.startsWith("video/") || MEDIA_VIDEO_EXT.includes(ext)) return "video";
  if (mime.startsWith("audio/") || MEDIA_AUDIO_EXT.includes(ext)) return "audio";
  return null;
}

/** Total size from Content-Range (206) or Content-Length (200). */
function mediaSize(statusCode, headers) {
  if (statusCode === 206) {
    const total = /\/(\d+)\s*$/.exec(mediaHeader(headers, "content-range"));
    return total ? Number(total[1]) : 0;
  }
  return Number(mediaHeader(headers, "content-length")) || 0;
}

// ---------------------------------------------------------------------------
// Per-tab store (storage.session survives the service worker being stopped)
// ---------------------------------------------------------------------------

const mediaCache = new Map(); // tabId -> items
const mediaLocks = new Map(); // tabId -> promise chain

const mediaKey = (tabId) => `media:${tabId}`;

async function mediaLoad(tabId) {
  if (mediaCache.has(tabId)) return mediaCache.get(tabId);
  let items = [];
  try {
    const got = await ext.storage.session.get(mediaKey(tabId));
    items = got[mediaKey(tabId)] || [];
  } catch {
    /* storage.session unavailable: memory only */
  }
  mediaCache.set(tabId, items);
  return items;
}

/** Serialize read-modify-write per tab (webRequest events arrive in bursts). */
function mediaUpdate(tabId, fn) {
  const run = async () => {
    const items = await mediaLoad(tabId);
    const next = (await fn(items.slice())) || items;
    mediaCache.set(tabId, next);
    try {
      await ext.storage.session.set({ [mediaKey(tabId)]: next });
    } catch {
      /* ignore */
    }
    mediaBadge(tabId, next);
    return next;
  };
  const p = (mediaLocks.get(tabId) || Promise.resolve()).then(run, run);
  mediaLocks.set(
    tabId,
    p.catch(() => {}),
  );
  return p;
}

function mediaClear(tabId) {
  return mediaUpdate(tabId, () => []);
}

/** Items worth showing: variant playlists of a known master are folded in. */
function mediaVisible(items) {
  const children = new Set(items.flatMap((i) => i.variants || []));
  return items.filter((i) => !children.has(i.url));
}

async function mediaBadge(tabId, items) {
  items = items || (await mediaLoad(tabId));
  const n = mediaVisible(items).length;
  try {
    await ext.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
    await ext.action.setBadgeText({ tabId, text: n ? String(n) : "" });
  } catch {
    /* tab closed */
  }
}

// ---------------------------------------------------------------------------
// HLS playlist inspection (best effort; downloads work without it)
// ---------------------------------------------------------------------------

function m3u8Attrs(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^"|"$/g, "");
  return out;
}

/** -> { master, variants[], resolution, bandwidth, duration, live, splitAudio } */
function m3u8Summary(text, baseUrl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines[0] || !lines[0].startsWith("#EXTM3U")) return null;
  const variants = [];
  const externalAudio = new Set();
  let pending = null;
  let duration = 0;
  let ended = false;
  let segments = 0;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const a = m3u8Attrs(line.slice(18));
      const res = /^(\d+)x(\d+)$/i.exec(a.RESOLUTION || "");
      pending = {
        bandwidth: Number(a.BANDWIDTH) || 0,
        width: res ? Number(res[1]) : 0,
        height: res ? Number(res[2]) : 0,
        audio: a.AUDIO || null,
      };
    } else if (line.startsWith("#EXT-X-MEDIA:")) {
      const a = m3u8Attrs(line.slice(13));
      if (a.TYPE === "AUDIO" && a.URI && a["GROUP-ID"]) externalAudio.add(a["GROUP-ID"]);
    } else if (line.startsWith("#EXTINF:")) {
      duration += parseFloat(line.slice(8)) || 0;
    } else if (line === "#EXT-X-ENDLIST" || line === "#EXT-X-PLAYLIST-TYPE:VOD") {
      ended = true;
    } else if (!line.startsWith("#")) {
      let url = line;
      try {
        url = new URL(line, baseUrl).href;
      } catch {
        /* keep raw */
      }
      if (pending) {
        variants.push({ ...pending, url });
        pending = null;
      } else {
        segments++;
      }
    }
  }
  if (variants.length) {
    const muxed = variants.filter((v) => !v.audio || !externalAudio.has(v.audio));
    const pool = muxed.length ? muxed : variants;
    const best = pool.reduce((a, b) =>
      b.width * b.height > a.width * a.height || (b.width * b.height === a.width * a.height && b.bandwidth > a.bandwidth)
        ? b
        : a,
    );
    return {
      master: true,
      variants: variants.map((v) => v.url),
      variantUrl: best.url,
      resolution: best.height ? [best.width, best.height] : null,
      bandwidth: best.bandwidth || null,
      splitAudio: muxed.length === 0,
    };
  }
  return { master: false, variants: [], duration, live: !ended, segments };
}

async function mediaFetchText(url) {
  const res = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Fill in quality / duration for an HLS item. */
async function mediaInspectHls(tabId, url) {
  try {
    const summary = m3u8Summary(await mediaFetchText(url), url);
    if (!summary) return;
    let extra = { master: summary.master, variants: summary.variants };
    if (summary.master) {
      extra = { ...extra, resolution: summary.resolution, bandwidth: summary.bandwidth, splitAudio: summary.splitAudio };
      // Duration lives in the variant playlist.
      try {
        const v = m3u8Summary(await mediaFetchText(summary.variantUrl), summary.variantUrl);
        if (v && !v.master) extra = { ...extra, duration: v.duration, live: v.live };
      } catch {
        /* ignore */
      }
    } else {
      extra = { ...extra, duration: summary.duration, live: summary.live };
    }
    if (extra.duration && extra.bandwidth) extra.size = Math.round((extra.bandwidth * extra.duration) / 8);
    await mediaUpdate(tabId, (items) => items.map((i) => (i.url === url ? { ...i, ...extra, inspected: true } : i)));
  } catch {
    await mediaUpdate(tabId, (items) => items.map((i) => (i.url === url ? { ...i, inspected: true } : i)));
  }
}

// ---------------------------------------------------------------------------
// Network observation
// ---------------------------------------------------------------------------

/** requestId -> Referer actually sent (CDNs often check it). */
const mediaReferers = new Map();

const mediaExtraHeaders =
  ext.webRequest && ext.webRequest.OnSendHeadersOptions && ext.webRequest.OnSendHeadersOptions.EXTRA_HEADERS;

if (ext.webRequest) {
  ext.webRequest.onSendHeaders.addListener(
    (d) => {
      if (d.tabId < 0) return;
      const ref = mediaHeader(d.requestHeaders, "referer");
      if (!ref) return;
      if (mediaReferers.size > 500) mediaReferers.clear();
      mediaReferers.set(d.requestId, ref);
    },
    { urls: ["<all_urls>"], types: MEDIA_TYPES },
    mediaExtraHeaders ? ["requestHeaders", mediaExtraHeaders] : ["requestHeaders"],
  );

  ext.webRequest.onHeadersReceived.addListener(
    (d) => {
      const referer = mediaReferers.get(d.requestId);
      mediaReferers.delete(d.requestId);
      if (d.tabId < 0 || (d.statusCode !== 200 && d.statusCode !== 206)) return;
      if (!/^https?:/i.test(d.url)) return;
      if (mediaFromFeedSite(d.documentUrl || d.initiator || "")) return;
      const mime = mediaHeader(d.responseHeaders, "content-type");
      const type = mediaClassify(d.url, mime);
      if (!type) return;
      const size = type === "hls" ? 0 : mediaSize(d.statusCode, d.responseHeaders);
      if (type !== "hls" && size && size < MEDIA_MIN_BYTES) return;
      mediaRecord(d.tabId, {
        url: d.url,
        type,
        mime: mime.split(";")[0].trim() || null,
        size: size || null,
        frameId: d.frameId,
        referrer: referer || d.documentUrl || d.initiator || null,
      });
    },
    { urls: ["<all_urls>"], types: MEDIA_TYPES },
    ["responseHeaders"],
  );

  ext.webRequest.onErrorOccurred.addListener((d) => mediaReferers.delete(d.requestId), {
    urls: ["<all_urls>"],
    types: MEDIA_TYPES,
  });
}

async function mediaRecord(tabId, item) {
  let isNew = false;
  await mediaUpdate(tabId, (items) => {
    const i = items.findIndex((x) => x.url === item.url);
    if (i >= 0) {
      // Same file seen again (players request ranges repeatedly).
      items[i] = { ...items[i], size: items[i].size || item.size, seen: Date.now() };
      return items;
    }
    isNew = true;
    items.push({ ...item, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, seen: Date.now() });
    return items.slice(-MEDIA_MAX_PER_TAB);
  });
  if (isNew && item.type === "hls") mediaInspectHls(tabId, item.url);
}

// A page load (or a new URL in single-page apps) starts a new list.
const mediaPages = new Map(); // tabId -> URL without #hash
ext.tabs.onUpdated.addListener((tabId, info) => {
  const page = info.url ? info.url.split("#")[0] : null;
  const changed = page && mediaPages.has(tabId) && mediaPages.get(tabId) !== page;
  if (page) mediaPages.set(tabId, page);
  if (info.status === "loading" || changed) mediaClear(tabId);
});

ext.tabs.onRemoved.addListener((tabId) => {
  mediaCache.delete(tabId);
  mediaLocks.delete(tabId);
  mediaPages.delete(tabId);
  ext.storage.session.remove(mediaKey(tabId)).catch(() => {});
});

// ---------------------------------------------------------------------------
// Choosing and sending
// ---------------------------------------------------------------------------

function mediaCleanTitle(title) {
  return (title || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150)
    .trim();
}

function mediaExtFor(item) {
  if (item.type === "hls") return "ts"; // the app switches to .mp4 for fMP4 streams
  const fromUrl = mediaPathExt(item.url);
  if ([...MEDIA_VIDEO_EXT, ...MEDIA_AUDIO_EXT].includes(fromUrl)) return fromUrl;
  return MEDIA_MIME_EXT[item.mime] || (item.type === "audio" ? "mp3" : "mp4");
}

function mediaUrlName(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

/** Unsupported items are still listed, with the reason. */
function mediaProblem(item) {
  if (item.live) return "Đang phát trực tiếp";
  if (item.splitAudio) return "Tiếng tách riêng";
  return null;
}

/** Best guess for "the video the user means" in a tab / frame. */
function mediaPickBest(items, frameId) {
  const usable = mediaVisible(items).filter((i) => !mediaProblem(i));
  const pool = usable.filter((i) => i.frameId === frameId);
  const list = pool.length ? pool : usable;
  const score = (i) =>
    (i.type === "hls" ? 3e15 : i.type === "video" ? 2e15 : 1e15) +
    (i.master ? 5e14 : 0) +
    (i.size || 0) +
    (i.duration || 0);
  return list.reduce((best, i) => (!best || score(i) > score(best) ? i : best), null);
}

// ---------------------------------------------------------------------------
// Video pages (YouTube, TikTok…): the app downloads them with yt-dlp
// ---------------------------------------------------------------------------

/** Pages whose video the app can fetch by URL (yt-dlp). */
const MEDIA_PAGES = [
  ["YouTube", /^https?:\/\/(www\.|m\.|music\.)?youtube\.com\/(watch\?|shorts\/|live\/|embed\/)|^https?:\/\/youtu\.be\/|^https?:\/\/(www\.)?youtube-nocookie\.com\/embed\//],
  ["TikTok", /^https?:\/\/(www\.|m\.)?tiktok\.com\/(@[^/]+\/video\/\d+|embed)/],
  ["Facebook", /^https?:\/\/(www\.|m\.|web\.)?facebook\.com\/(.+\/videos\/|watch\/?\?|reel\/|share\/[vr]\/)|^https?:\/\/fb\.watch\//],
  ["Instagram", /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\//],
  ["X", /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[^/]+\/status\/\d+/],
  ["Vimeo", /^https?:\/\/(www\.)?vimeo\.com\/\d+|^https?:\/\/player\.vimeo\.com\/video\/\d+/],
  ["Dailymotion", /^https?:\/\/(www\.)?dailymotion\.com\/(video|embed\/video)\/|^https?:\/\/dai\.ly\//],
  ["SoundCloud", /^https?:\/\/(www\.|m\.)?soundcloud\.com\/[^/]+\/[^/?#]+/],
  ["Bilibili", /^https?:\/\/(www\.)?bilibili\.com\/video\//],
  ["Twitch", /^https?:\/\/(www\.)?twitch\.tv\/(videos\/\d+|[^/]+\/clip\/)|^https?:\/\/clips\.twitch\.tv\//],
];

/** -> site name when `url` is a video page, else null. */
function mediaPageSite(url) {
  if (!url) return null;
  const hit = MEDIA_PAGES.find(([, re]) => re.test(url));
  return hit ? hit[0] : null;
}

function mediaPageItem(url) {
  const site = mediaPageSite(url);
  if (!site) return null;
  return { id: "page", url: url.split("#")[0], type: "page", site, frameId: null };
}

function mediaLabel(item) {
  if (item.type === "page") return item.site;
  const parts = [];
  if (item.type === "hls") parts.push("HLS");
  else parts.push(mediaExtFor(item).toUpperCase());
  if (item.resolution) parts.push(`${Math.min(item.resolution[0], item.resolution[1])}p`);
  return parts.join(" ");
}

async function mediaSend(tabId, item) {
  const s = await pairedSettings();
  if (!s) return { ok: false, error: "Chưa kết nối với app" };
  let tab = null;
  try {
    tab = await ext.tabs.get(tabId);
  } catch {
    /* closed */
  }
  let ok;
  if (item.type === "page") {
    // The app asks yt-dlp for the title and lets the user pick a quality.
    ok = await sendToApp(s, { url: item.url, referrer: null, kind: "media" });
  } else {
    const title = mediaCleanTitle(tab && tab.title);
    const base = title || mediaCleanTitle(mediaUrlName(item.url).replace(/\.[a-z0-9]+$/i, "")) || "video";
    ok = await sendToApp(s, {
      url: item.url,
      fileName: `${base}.${mediaExtFor(item)}`,
      fileSize: item.type === "hls" ? 0 : item.size || 0,
      mime: item.mime,
      referrer: item.referrer || (tab && tab.url) || null,
      kind: item.type === "hls" ? "hls" : null,
    });
  }
  flashBadge(ok ? "✓" : "!", ok ? "#16a34a" : "#dc2626", tabId);
  return ok ? { ok: true } : { ok: false, error: "App không nhận (hãy mở DownloadManager)" };
}

async function mediaTabUrl(tabId) {
  try {
    return (await ext.tabs.get(tabId)).url || null;
  } catch {
    return null;
  }
}

/** The first candidate URL that is a video page. */
function mediaFirstPage(urls) {
  for (const u of urls || []) {
    const page = mediaPageItem(u);
    if (page) return page;
  }
  return null;
}

/**
 * The video page for a tab: its URL, or, on feeds whose URL does not change
 * per video (TikTok "For You"…), the video on screen as content.js sees it.
 */
async function mediaTabPage(tabId) {
  const page = mediaPageItem(await mediaTabUrl(tabId));
  if (page) return page;
  try {
    const urls = await ext.tabs.sendMessage(tabId, { type: "dm-current-video" }, { frameId: 0 });
    return mediaFirstPage(urls);
  } catch {
    return null; // no content script (browser pages, not yet loaded)
  }
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    // Popup: everything found in a tab (the page itself first on video sites).
    "media-list": async () => {
      const items = mediaVisible(await mediaLoad(msg.tabId));
      const page = await mediaTabPage(msg.tabId);
      return [...(page ? [page] : []), ...items].map((i) => ({
        ...i,
        label: mediaLabel(i),
        problem: mediaProblem(i),
        urlName: mediaUrlName(i.url),
      }));
    },
    "media-download": async () => {
      const item =
        msg.id === "page"
          ? await mediaTabPage(msg.tabId)
          : (await mediaLoad(msg.tabId)).find((i) => i.id === msg.id);
      return item ? mediaSend(msg.tabId, item) : { ok: false, error: "Không còn thấy video này" };
    },
    // Content script: what the video element under the pointer can be saved as.
    "media-best": async () => {
      const prefs = await dmSettings();
      if (!prefs.showVideoButton || !sender.tab) return null;
      const item = await mediaForElement(sender.tab.id, sender.frameId, msg.src, msg.pages);
      return item ? { label: mediaLabel(item) } : null;
    },
    "media-download-best": async () => {
      if (!sender.tab) return { ok: false };
      const item = await mediaForElement(sender.tab.id, sender.frameId, msg.src, msg.pages);
      if (!item) return { ok: false, error: "Không tìm thấy luồng tải được" };
      return mediaSend(sender.tab.id, item);
    },
  };
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  handler().then(sendResponse, () => sendResponse(null));
  return true;
});

/**
 * A video page wins: the app fetches it with yt-dlp. `pages` are candidate
 * URLs from content.js, most specific first (the TikTok post holding the
 * video, the frame's URL, links in the post). Otherwise a direct http(s) src,
 * else the best stream seen in the frame (blob: sources from streaming
 * players). On feed sites nothing is better than a neighbouring video.
 */
async function mediaForElement(tabId, frameId, src, pages) {
  const urls = Array.isArray(pages) ? pages : [pages];
  const page = mediaFirstPage(urls);
  if (page) return page;
  if (mediaFromFeedSite(urls[0])) return null;
  const items = await mediaLoad(tabId);
  if (src && /^https?:/i.test(src)) {
    const known = items.find((i) => i.url === src);
    if (known) return known;
    const type = mediaClassify(src, "") || "video";
    return { url: src, type, mime: null, size: null, frameId, referrer: null };
  }
  return mediaPickBest(items, frameId);
}

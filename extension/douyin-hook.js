// Douyin: runs in the page itself (MAIN world) from document_start. Douyin's
// own API answers (feed, video detail, search…) carry every video's stream
// links, H.264 included; yt-dlp cannot fetch them (the API needs signatures
// only the page can make). This reads those answers as the page receives them
// and hands a compact summary to content.js through window.postMessage.
// It never changes what the page sees.

(() => {
  if (window.__dmDouyinHook) return;
  window.__dmDouyinHook = true;

  const MAX = 300;
  const videos = new Map(); // aweme_id -> summary

  // Same function as dmDouyinKey in content.js (kept identical by hand):
  // the file id in a stream URL, which stays the same across CDN hosts and
  // signatures. /aweme/v1/play/?video_id=X -> X; .../video/tos/.../<id>/ -> <id>.
  const douyinKey = (u) => {
    try {
      const url = new URL(u, location.href);
      const vid = url.searchParams.get("video_id");
      if (vid) return vid;
      const parts = url.pathname.split("/").filter(Boolean);
      const i = parts.indexOf("video");
      return i >= 0 && parts.length > i + 1 ? parts[parts.length - 1] : null;
    } catch {
      return null;
    }
  };

  const isHevc = (b) =>
    b.is_bytevc1 === 1 || b.is_h265 === 1 || /bytevc1|h265|hevc/i.test(`${b.gear_name || ""} ${b.format || ""}`);

  const firstUrl = (addr) => (addr && Array.isArray(addr.url_list) ? addr.url_list.find((u) => /^https?:\/\//.test(u)) : null);

  /** Best stream of one aweme: H.264 first, then height, then bitrate. */
  function pick(video) {
    const options = [];
    for (const b of Array.isArray(video.bit_rate) ? video.bit_rate : []) {
      const url = firstUrl(b.play_addr);
      if (!url) continue;
      options.push({
        url,
        hevc: isHevc(b),
        width: b.play_addr.width || video.width || 0,
        height: b.play_addr.height || video.height || 0,
        size: b.play_addr.data_size || 0,
        bitrate: b.bit_rate || 0,
      });
    }
    for (const addr of [video.play_addr_h264, video.play_addr]) {
      const url = firstUrl(addr);
      if (url) {
        options.push({
          url,
          hevc: false,
          width: addr.width || video.width || 0,
          height: addr.height || video.height || 0,
          size: addr.data_size || 0,
          bitrate: 0,
        });
      }
    }
    const short = (o) => Math.min(o.width, o.height) || Math.max(o.width, o.height);
    options.sort((a, b) => a.hevc - b.hevc || short(b) - short(a) || b.bitrate - a.bitrate);
    return options[0] || null;
  }

  /**
   * Keys of every file of this video (all qualities), so content.js can tell
   * which post a <video> element is playing from its src.
   */
  function fileKeys(video) {
    const keys = new Set();
    const addrs = [video.play_addr, video.play_addr_h264, video.play_addr_265, video.download_addr];
    for (const b of Array.isArray(video.bit_rate) ? video.bit_rate : []) addrs.push(b.play_addr);
    for (const a of addrs) {
      for (const u of (a && Array.isArray(a.url_list) && a.url_list) || []) {
        const k = douyinKey(u);
        if (k) keys.add(k);
      }
    }
    return [...keys].slice(0, 30);
  }

  function summarize(aweme) {
    const video = aweme.video;
    if (!video || typeof video !== "object") return null;
    const best = pick(video);
    if (!best) return null;
    const author = aweme.author && aweme.author.nickname;
    return {
      id: String(aweme.aweme_id),
      title: String(aweme.desc || author || aweme.aweme_id).slice(0, 200),
      author: author || null,
      duration: video.duration ? Math.round(video.duration / 1000) : null,
      keys: fileKeys(video),
      ...best,
    };
  }

  /** Every object that looks like a video post, wherever it is nested. */
  function collect(node, out, depth) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) {
      for (const x of node) collect(x, out, depth + 1);
      return;
    }
    if (node.aweme_id && node.video) {
      const s = summarize(node);
      if (s) out.push(s);
    }
    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object") collect(v, out, depth + 1);
    }
  }

  function publish(list) {
    if (!list.length) return;
    for (const s of list) {
      videos.delete(s.id);
      videos.set(s.id, s);
    }
    while (videos.size > MAX) videos.delete(videos.keys().next().value);
    window.postMessage({ __dm: "douyin-videos", videos: list }, location.origin);
  }

  function inspect(url, body) {
    try {
      if (!/\/aweme\/v\d+\/|\/web\/api\//.test(String(url))) return;
      const data = typeof body === "string" ? JSON.parse(body) : body;
      const out = [];
      collect(data, out, 0);
      publish(out);
    } catch {
      /* not JSON, or not ours */
    }
  }

  // XMLHttpRequest
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this.addEventListener("load", () => {
        try {
          const t = this.responseType;
          if (t === "" || t === "text") inspect(url, this.responseText);
          else if (t === "json") inspect(url, this.response);
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore */
    }
    return open.call(this, method, url, ...rest);
  };

  // fetch
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const p = origFetch.call(this, input, init);
      try {
        const url = typeof input === "string" ? input : input && input.url;
        if (/\/aweme\/v\d+\/|\/web\/api\//.test(String(url))) {
          p.then((res) => res.clone().text().then((t) => inspect(url, t))).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return p;
    };
  }

  // content.js loads later (document_idle) and asks for what it missed.
  window.addEventListener("message", (e) => {
    if (e.source === window && e.data && e.data.__dm === "douyin-sync") {
      window.postMessage({ __dm: "douyin-videos", videos: [...videos.values()] }, location.origin);
    }
  });
})();

// Shows a "Tải video" button over the video under the mouse pointer, when
// the extension has found something downloadable for it. Runs in every frame
// (players often live in iframes). Lives in a closed shadow root so page CSS
// cannot touch it.

(() => {
  if (window.__dmVideoButton) return;
  window.__dmVideoButton = true;

  const ext = globalThis.browser ?? globalThis.chrome;
  // Content scripts do not load common.js (dmT); same lookup, inlined.
  const tr = (key) => {
    try {
      return ext.i18n.getMessage(key) || key;
    } catch {
      return key; // extension reloaded: the old context is gone
    }
  };
  const MIN_W = 200;
  const MIN_H = 120;
  const HIDE_DELAY = 1200;
  const videos = document.getElementsByTagName("video");

  let enabled = true;
  ext.storage.local.get("showVideoButton").then((s) => {
    enabled = s.showVideoButton !== false;
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.showVideoButton) {
      enabled = changes.showVideoButton.newValue !== false;
      if (!enabled) hide();
    }
  });

  // ---------- UI ----------
  let host = null;
  let btn = null;
  let labelEl = null;
  let subEl = null;

  function build() {
    host = document.createElement("dm-video-button");
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; display: none;";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        button {
          all: initial;
          display: inline-flex; align-items: center; gap: 8px;
          padding: 7px 12px 7px 9px; border-radius: 10px; cursor: pointer;
          font: 600 13px/1.2 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
          color: #fff; background: linear-gradient(to bottom, #3b74f0, #2563eb);
          box-shadow: 0 4px 14px -2px rgb(15 23 42 / 0.45), inset 0 0 0 1px rgb(255 255 255 / 0.12);
          opacity: 0; transform: translateY(-4px);
          transition: opacity .15s, transform .15s, background .15s;
          user-select: none; white-space: nowrap;
        }
        button.show { opacity: 1; transform: none; }
        button:hover { background: linear-gradient(to bottom, #3b74f0, #1d4ed8); }
        button:active { transform: scale(0.97); }
        button.ok { background: #16a34a; }
        button.err { background: #dc2626; }
        button.busy { cursor: progress; }
        svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor;
              stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
        .text { display: flex; flex-direction: column; }
        .sub { font-weight: 500; font-size: 11px; opacity: .85; }
        .sub:empty { display: none; }
      </style>
      <button type="button" part="button">
        <svg viewBox="0 0 24 24"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>
        <span class="text"><span class="label"></span><span class="sub"></span></span>
      </button>`;
    btn = root.querySelector("button");
    labelEl = root.querySelector(".label");
    subEl = root.querySelector(".sub");
    btn.addEventListener("click", onClick, true);
    // Keep the page's player from reacting to clicks on our button.
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick"]) {
      btn.addEventListener(t, (e) => e.stopPropagation(), true);
    }
    host.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    host.addEventListener("mouseleave", scheduleHide);
    mount();
  }

  /** In fullscreen only the fullscreen element's subtree is visible. */
  function mount() {
    if (!host) return;
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== "VIDEO" ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }
  document.addEventListener("fullscreenchange", () => {
    mount();
    place();
  });

  // ---------- Tracking the video under the pointer ----------
  let current = null; // video element the button belongs to
  let state = "idle"; // idle | busy | done
  let hideTimer = 0;
  const cache = new WeakMap(); // video -> { at, src, result }

  function videoAt(x, y) {
    for (const v of videos) {
      const r = v.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const style = getComputedStyle(v);
        if (style.visibility !== "hidden" && style.display !== "none") return v;
      }
    }
    return null;
  }

  // ---------- Douyin: stream links read by douyin-hook.js ----------
  // yt-dlp cannot fetch Douyin, so its videos are sent as direct H.264 links
  // taken from the API answers the page already received.
  const onDouyin = /(^|\.)douyin\.com$/.test(location.hostname);
  const douyin = new Map(); // aweme id -> { id, title, url, size, width, height, hevc, keys }

  /** Same as douyinKey in douyin-hook.js: the file id in a stream URL. */
  function dmDouyinKey(u) {
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
  }

  if (onDouyin) {
    window.addEventListener("message", (e) => {
      if (e.source !== window || !e.data || e.data.__dm !== "douyin-videos" || !Array.isArray(e.data.videos)) return;
      for (const v of e.data.videos) {
        // The page is not trusted: keep only well-formed entries.
        if (!v || !/^\d{6,25}$/.test(String(v.id)) || !/^https:\/\//.test(String(v.url))) continue;
        douyin.delete(v.id);
        douyin.set(String(v.id), {
          id: String(v.id),
          title: String(v.title || v.id).slice(0, 200),
          url: String(v.url),
          size: Number(v.size) || 0,
          width: Number(v.width) || 0,
          height: Number(v.height) || 0,
          hevc: !!v.hevc,
          keys: Array.isArray(v.keys) ? v.keys.map(String).slice(0, 30) : [],
        });
      }
      while (douyin.size > 300) douyin.delete(douyin.keys().next().value);
    });
    window.postMessage({ __dm: "douyin-sync" }, location.origin);
  }

  /** The Douyin post a <video> element shows, or null when unsure. */
  function douyinFor(video, box, links) {
    if (!onDouyin || !douyin.size) return null;
    // 1. The file it plays (direct douyinvod.com sources).
    const srcs = [video.currentSrc, video.src, ...[...video.querySelectorAll("source")].map((s) => s.src)];
    for (const s of srcs) {
      const k = s && /^https?:/.test(s) ? dmDouyinKey(s) : null;
      if (!k) continue;
      for (const v of douyin.values()) if (v.keys.includes(k)) return v;
    }
    // 2. A video id: the player's data-e2e-vid, the URL, links in the post.
    const ids = [];
    for (let el = video; el && el !== box.parentElement; el = el.parentElement) {
      const vid = el.getAttribute && el.getAttribute("data-e2e-vid");
      if (vid) ids.push(vid);
    }
    const fromUrl = /[?&]modal_id=(\d+)|\/video\/(\d+)/.exec(location.href);
    if (fromUrl) ids.push(fromUrl[1] || fromUrl[2]);
    for (const h of links) {
      const m = /douyin\.com\/video\/(\d+)/.exec(h);
      if (m) ids.push(m[1]);
    }
    for (const id of ids) if (douyin.has(id)) return douyin.get(id);
    return null;
  }

  /** The post around a video (the largest ancestor holding no other video) and its links. */
  function postOf(video) {
    let box = video;
    for (let i = 0; i < 15; i++) {
      const up = box.parentElement;
      if (!up || up === document.body || up.getElementsByTagName("video").length > 1) break;
      box = up;
    }
    return { box, links: [...box.querySelectorAll("a[href]")].map((a) => a.href).slice(0, 40) };
  }

  /** Everything the extension needs to pick what to download for a video. */
  function describe(video) {
    const { box, links } = postOf(video);
    return { pages: pageCandidates(video, box, links), direct: douyinFor(video, box, links) };
  }

  /**
   * URLs that may be the page of this video, most specific first. Feeds
   * (TikTok "For You", Instagram, YouTube's home page) keep one URL for many
   * videos, so the post around the video says which one it is. The extension
   * keeps the first one that is a known video page.
   */
  function pageCandidates(video, box, links) {
    const out = [];
    // TikTok's player sits in <div id="xgwrapper-0-<video id>">. yt-dlp
    // accepts any user name with the id.
    for (let el = video; el && el !== box.parentElement; el = el.parentElement) {
      const m = /^xgwrapper-\d+-(\d{8,})$/.exec(el.id || "");
      if (m) {
        const author = links.map((h) => /tiktok\.com\/@([\w.-]+)/.exec(h)).find(Boolean);
        out.push(`https://www.tiktok.com/@${author ? author[1] : "_"}/video/${m[1]}`);
        break;
      }
    }
    // Douyin's feed marks each player with data-e2e-vid="<video id>".
    for (let el = video; el && el !== box.parentElement; el = el.parentElement) {
      const vid = el.getAttribute && el.getAttribute("data-e2e-vid");
      if (vid && /^\d{8,}$/.test(vid)) {
        out.push(`https://www.douyin.com/video/${vid}`);
        break;
      }
    }
    out.push(location.href, ...links);
    return out;
  }

  /** The video the user is most likely looking at: largest on screen. */
  function mainVideo() {
    let best = null;
    let bestArea = 0;
    for (const v of videos) {
      const r = v.getBoundingClientRect();
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (w < MIN_W / 2 || h < MIN_H / 2) continue;
      if (w * h > bestArea) {
        best = v;
        bestArea = w * h;
      }
    }
    return best;
  }

  // Popup and context menu: which video page is this frame showing?
  let contextVideo = null;
  document.addEventListener(
    "contextmenu",
    (e) => {
      contextVideo = e.target instanceof HTMLVideoElement ? e.target : videoAt(e.clientX, e.clientY);
    },
    true,
  );
  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "dm-current-video") return false;
    const v = (contextVideo && contextVideo.isConnected && contextVideo) || mainVideo();
    contextVideo = null;
    sendResponse(v ? describe(v) : { pages: [location.href], direct: null });
    return false;
  });

  async function lookup(video) {
    const src = video.currentSrc || video.src || "";
    const hit = cache.get(video);
    if (hit && hit.src === src && Date.now() - hit.at < 4000) return hit.result;
    let result = null;
    try {
      result = await ext.runtime.sendMessage({ type: "media-best", src, ...describe(video) });
    } catch {
      /* extension reloaded */
    }
    cache.set(video, { at: Date.now(), src, result });
    return result;
  }

  function place() {
    if (!host || !current) return;
    const r = current.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.width < MIN_W) return hide();
    const top = Math.max(8, r.top + 12);
    const right = Math.min(innerWidth - 8, r.right - 12);
    host.style.top = `${top}px`;
    host.style.left = `${right}px`;
    host.style.transform = "translateX(-100%)";
  }

  async function show(video) {
    if (state !== "idle" && current === video) return;
    const result = await lookup(video);
    if (!result || !enabled) return;
    if (!host) build();
    mount();
    current = video;
    state = "idle";
    btn.className = "";
    labelEl.textContent = tr("videoButton");
    subEl.textContent = result.label || "";
    host.style.display = "block";
    place();
    requestAnimationFrame(() => btn.classList.add("show"));
  }

  function hide() {
    clearTimeout(hideTimer);
    if (!host || state === "busy") return;
    btn.classList.remove("show");
    host.style.display = "none";
    current = null;
    state = "idle";
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_DELAY);
  }

  let pending = false;
  let lastX = 0;
  let lastY = 0;
  document.addEventListener(
    "mousemove",
    (e) => {
      if (!enabled || !videos.length) return;
      lastX = e.clientX;
      lastY = e.clientY;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const v = videoAt(lastX, lastY);
        if (v) {
          clearTimeout(hideTimer);
          if (v !== current) show(v);
        } else if (current) {
          scheduleHide();
        }
      });
    },
    { passive: true, capture: true },
  );
  addEventListener("scroll", () => current && place(), { passive: true, capture: true });
  addEventListener("resize", () => current && place(), { passive: true });

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!current || state === "busy") return;
    state = "busy";
    btn.className = "show busy";
    labelEl.textContent = tr("sending");
    let res = null;
    try {
      res = await ext.runtime.sendMessage({
        type: "media-download-best",
        src: current.currentSrc || current.src || "",
        ...describe(current),
      });
    } catch {
      /* extension reloaded */
    }
    state = "done";
    if (res && res.ok) {
      btn.className = "show ok";
      labelEl.textContent = tr("sentToApp");
      subEl.textContent = "";
    } else {
      btn.className = "show err";
      labelEl.textContent = tr("sendFailed");
      subEl.textContent = (res && res.error) || tr("openApp");
    }
    setTimeout(() => {
      state = "idle";
      hide();
    }, 2500);
  }
})();

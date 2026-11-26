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
  // How often to look again while the pointer rests: feeds start a hover
  // preview a moment after the pointer stops, with no further mousemove.
  const IDLE_CHECK_MS = 500;
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
    // A small frosted-glass pill: an icon only, until hovered, then it widens
    // to show the label. Subdued so it does not cover the video.
    root.innerHTML = `
      <style>
        button {
          all: initial; box-sizing: border-box;
          display: inline-flex; align-items: center;
          height: 32px; min-width: 32px; padding: 0 7px; border-radius: 999px; cursor: pointer;
          font: 600 12px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "SF Pro Text", sans-serif;
          color: #fff; text-shadow: 0 1px 2px rgb(0 0 0 / .35);
          background-color: rgb(20 24 33 / .26);
          background-image: linear-gradient(180deg, rgb(255 255 255 / .26), rgb(255 255 255 / .06) 55%, rgb(255 255 255 / .1));
          -webkit-backdrop-filter: blur(14px) saturate(170%); backdrop-filter: blur(14px) saturate(170%);
          border: 1px solid rgb(255 255 255 / .3);
          box-shadow: inset 0 1px 0 rgb(255 255 255 / .4), inset 0 -1px 0 rgb(0 0 0 / .1),
                      0 6px 20px -8px rgb(0 0 0 / .5);
          opacity: 0; transform: translateY(-4px) scale(.94);
          transition: opacity .18s ease, transform .18s ease, background-color .18s ease;
          user-select: none; white-space: nowrap;
        }
        button.show { opacity: .72; transform: none; }
        button:hover, button.busy, button.ok, button.err { opacity: 1; }
        button:hover { background-color: rgb(20 24 33 / .38); }
        button:active { transform: scale(.95); }
        button.ok { background-color: rgb(22 163 74 / .6); }
        button.err { background-color: rgb(220 38 38 / .6); }
        button.busy { cursor: progress; }
        svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor;
              stroke-width: 2.3; stroke-linecap: round; stroke-linejoin: round;
              filter: drop-shadow(0 1px 1px rgb(0 0 0 / .3)); }
        .busy svg { animation: dm-bob 1s ease-in-out infinite; }
        @keyframes dm-bob { 50% { transform: translateY(2px); } }
        .text { display: inline-flex; align-items: baseline; gap: 5px;
                max-width: 0; margin-left: 0; overflow: hidden;
                transition: max-width .25s ease, margin-left .25s ease; }
        button:hover .text, button.busy .text, button.ok .text, button.err .text {
          max-width: 260px; margin-left: 6px; margin-right: 3px;
        }
        .sub { font-weight: 500; font-size: 11px; opacity: .8; }
        .sub:empty { display: none; }
        @media (prefers-reduced-motion: reduce) {
          button, .text { transition: none; }
          .busy svg { animation: none; }
        }
      </style>
      <button type="button" part="button">
        <svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>
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
    host.addEventListener("mouseenter", () => {
      hostHovered = true;
      clearTimeout(hideTimer);
    });
    host.addEventListener("mouseleave", () => {
      hostHovered = false;
      scheduleHide();
    });
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
  let currentKey = ""; // what it was shown for (see targetKey)
  let currentInfo = null; // describe() result it was shown for
  let state = "idle"; // idle | busy | done
  let hideTimer = 0;
  let hostHovered = false;
  // Lookups by target key. Feeds reuse one <video> for every hover preview
  // (YouTube's home page), so the element alone does not say which video it is.
  const cache = new Map(); // key -> { at, result }

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
    // With a single <video> on the page (YouTube's hover preview) the climb
    // reaches a page-wide container; its links belong to other videos.
    const anchors = box.querySelectorAll("a[href]");
    if (anchors.length > 60) return { box, links: [] };
    return { box, links: [...anchors].map((a) => a.href).slice(0, 40) };
  }

  /**
   * Links under the point (x, y), topmost first. YouTube's home page plays
   * its hover preview in a player laid over the thumbnail, outside the card,
   * so the card's watch link is only found underneath the pointer.
   */
  function linksAt(x, y) {
    const out = [];
    if (x < 0 || y < 0) return out;
    let stack = [];
    try {
      stack = document.elementsFromPoint(x, y);
    } catch {
      return out;
    }
    for (const el of stack) {
      if (el === host || !el.closest) continue;
      const a = el.closest("a[href]");
      if (a && /^https?:/.test(a.href) && !out.includes(a.href)) out.push(a.href);
      if (out.length >= 6) break;
    }
    return out;
  }

  /**
   * Everything the extension needs to pick what to download for a video.
   * `x, y`: the pointer, when the video was found under it.
   */
  function describe(video, x = -1, y = -1) {
    const { box, links } = postOf(video);
    return { pages: pageCandidates(video, box, links, linksAt(x, y)), direct: douyinFor(video, box, links) };
  }

  /**
   * URLs that may be the page of this video, most specific first. Feeds
   * (TikTok "For You", Instagram, YouTube's home page) keep one URL for many
   * videos, so the post around the video, or the link under the pointer,
   * says which one it is. The extension keeps the first one that is a known
   * video page; the frame URL goes before the pointer's links so that on a
   * watch page, a suggestion card over the player does not win.
   */
  function pageCandidates(video, box, links, pointLinks = []) {
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
    out.push(location.href, ...pointLinks, ...links);
    return [...new Set(out)];
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
  let contextPoint = [-1, -1];
  document.addEventListener(
    "contextmenu",
    (e) => {
      contextVideo = e.target instanceof HTMLVideoElement ? e.target : videoAt(e.clientX, e.clientY);
      contextPoint = [e.clientX, e.clientY];
    },
    true,
  );
  ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "dm-current-video") return false;
    let info;
    if (contextVideo && contextVideo.isConnected) info = describe(contextVideo, ...contextPoint);
    else if (current && current.isConnected && currentInfo) info = currentInfo;
    else {
      const v = mainVideo();
      info = v ? describe(v) : { pages: [location.href], direct: null };
    }
    contextVideo = null;
    sendResponse(info);
    return false;
  });

  /** Identifies what a button would download: the element is not enough. */
  function targetKey(src, info) {
    return [src, info.direct ? info.direct.id : "", ...info.pages.slice(0, 6)].join("\n");
  }

  async function lookup(key, src, info) {
    const hit = cache.get(key);
    // "Nothing found" is retried sooner: the player may still be loading.
    if (hit && Date.now() - hit.at < (hit.result ? 8000 : 1500)) return hit.result;
    let result = null;
    try {
      result = await ext.runtime.sendMessage({ type: "media-best", src, ...info });
    } catch {
      /* extension reloaded */
    }
    cache.set(key, { at: Date.now(), result });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return result;
  }

  function place() {
    if (!host || !current) return;
    const r = current.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.width < MIN_W) return hide();
    const top = Math.max(8, r.top + 10);
    const right = Math.min(innerWidth - 8, r.right - 10);
    host.style.top = `${top}px`;
    host.style.left = `${right}px`;
    host.style.transform = "translateX(-100%)";
  }

  let seq = 0; // newest lookup wins; older answers are dropped
  let inflightKey = "";

  async function show(video, key, src, info) {
    const my = ++seq;
    inflightKey = key;
    const result = await lookup(key, src, info);
    if (my !== seq) return;
    inflightKey = "";
    if (!enabled || state !== "idle") return;
    if (!result) {
      // Nothing to download here; do not leave the button on another target.
      if (current) hide();
      return;
    }
    if (!host) build();
    mount();
    // Same element, new target (or the same one found another way): update
    // in place instead of replaying the fade-in.
    const visible = current === video && host.style.display === "block";
    current = video;
    currentKey = key;
    currentInfo = info;
    if (!visible) btn.className = "";
    labelEl.textContent = tr("videoButton");
    subEl.textContent = result.label || "";
    btn.title = result.label ? `${tr("videoButton")} · ${result.label}` : tr("videoButton");
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
    currentKey = "";
    currentInfo = null;
    state = "idle";
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_DELAY);
  }

  // ---------- When to look ----------
  // On pointer moves, on scroll (the video under a still pointer changes), when
  // a video starts loading or playing (hover previews), and every
  // IDLE_CHECK_MS while the pointer rests on the page.
  let lastX = -1;
  let lastY = -1;
  let pointerIn = false;
  let lastEval = 0;
  let evalQueued = false;

  function evaluate() {
    evalQueued = false;
    lastEval = Date.now();
    if (!enabled || !pointerIn || !videos.length) return;
    const v = videoAt(lastX, lastY);
    if (!v) {
      if (current && !hostHovered) scheduleHide();
      return;
    }
    clearTimeout(hideTimer);
    if (state !== "idle") return; // keep "sending / sent / failed" on screen
    const info = describe(v, lastX, lastY);
    const src = v.currentSrc || v.src || "";
    const key = targetKey(src, info);
    if ((v === current && key === currentKey) || key === inflightKey) return;
    show(v, key, src, info);
  }

  /** Run evaluate() at most every ~100 ms, on the next frame. */
  function queueEvaluate() {
    if (evalQueued) return;
    evalQueued = true;
    const wait = Math.max(0, 100 - (Date.now() - lastEval));
    setTimeout(() => requestAnimationFrame(evaluate), wait);
  }

  document.addEventListener(
    "mousemove",
    (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      pointerIn = true;
      if (enabled && videos.length) queueEvaluate();
    },
    { passive: true, capture: true },
  );
  document.addEventListener(
    "mouseout",
    (e) => {
      if (!e.relatedTarget) pointerIn = false; // left the window / frame
    },
    { passive: true, capture: true },
  );
  // Media events do not bubble, but capture listeners on the document see them.
  for (const type of ["loadstart", "loadeddata", "playing"]) {
    document.addEventListener(type, () => pointerIn && queueEvaluate(), { passive: true, capture: true });
  }
  addEventListener(
    "scroll",
    () => {
      if (current) place();
      if (pointerIn) queueEvaluate();
    },
    { passive: true, capture: true },
  );
  addEventListener("resize", () => current && place(), { passive: true });
  setInterval(() => {
    if (pointerIn && enabled && videos.length && !document.hidden) queueEvaluate();
  }, IDLE_CHECK_MS);

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!current || state === "busy") return;
    state = "busy";
    btn.className = "show busy";
    labelEl.textContent = tr("sending");
    subEl.textContent = "";
    let res = null;
    try {
      res = await ext.runtime.sendMessage({
        type: "media-download-best",
        src: current.currentSrc || current.src || "",
        ...(currentInfo || describe(current)),
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

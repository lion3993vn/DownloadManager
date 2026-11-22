// Shows a "Tải video" button over the video under the mouse pointer, when
// the extension has found something downloadable for it. Runs in every frame
// (players often live in iframes). Lives in a closed shadow root so page CSS
// cannot touch it.

(() => {
  if (window.__dmVideoButton) return;
  window.__dmVideoButton = true;

  const ext = globalThis.browser ?? globalThis.chrome;
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
        <span class="text"><span class="label">Tải video</span><span class="sub"></span></span>
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

  async function lookup(video) {
    const src = video.currentSrc || video.src || "";
    const hit = cache.get(video);
    if (hit && hit.src === src && Date.now() - hit.at < 4000) return hit.result;
    let result = null;
    try {
      result = await ext.runtime.sendMessage({ type: "media-best", src });
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
    labelEl.textContent = "Tải video";
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
    labelEl.textContent = "Đang gửi…";
    let res = null;
    try {
      res = await ext.runtime.sendMessage({
        type: "media-download-best",
        src: current.currentSrc || current.src || "",
      });
    } catch {
      /* extension reloaded */
    }
    state = "done";
    if (res && res.ok) {
      btn.className = "show ok";
      labelEl.textContent = "Đã gửi sang app";
      subEl.textContent = "";
    } else {
      btn.className = "show err";
      labelEl.textContent = "Không gửi được";
      subEl.textContent = (res && res.error) || "Hãy mở DownloadManager";
    }
    setTimeout(() => {
      state = "idle";
      hide();
    }, 2500);
  }
})();

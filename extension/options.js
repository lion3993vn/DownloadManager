const $ = (id) => document.getElementById(id);

// Every change is saved right away; a toast confirms it.

/** File types shown as groups. Anything else the user adds goes under "other". */
const GROUPS = [
  {
    id: "archive",
    tile: "amber",
    icon: '<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>',
    exts: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "img", "dmg"],
  },
  {
    id: "program",
    tile: "violet",
    icon: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m9 9 2 2-2 2"/>',
    exts: ["exe", "msi", "msix", "apk", "deb", "rpm", "appimage", "pkg"],
  },
  {
    id: "video",
    tile: "rose",
    icon: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
    exts: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v"],
  },
  {
    id: "audio",
    tile: "fuchsia",
    icon: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    exts: ["mp3", "flac", "wav", "aac", "m4a", "ogg", "opus"],
  },
  {
    id: "document",
    tile: "sky",
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    exts: ["pdf", "epub", "doc", "docx", "xls", "xlsx", "ppt", "pptx"],
  },
];
const OTHER_ICON = '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>';
const X_ICON = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
const SIZE_PRESETS = [0, 10, 20, 50, 100];

let exts = [];
let toastTimer = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function svg(paths) {
  return `<svg class="i" viewBox="0 0 24 24">${paths}</svg>`;
}

function setStatus(state, title, desc) {
  $("status").dataset.state = state;
  $("status-title").textContent = title;
  $("status-desc").textContent = desc;
}

function toast() {
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1400);
}

async function save(values) {
  await ext.storage.local.set(values);
  toast();
}

function normalizeExt(raw) {
  return raw.trim().replace(/^\*?\./, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function saveExts() {
  return save({ extensions: exts.join(" ") });
}

// ---------- File types ----------

function switchEl(checked, label, onChange) {
  const s = el("span", "switch sm");
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => onChange(input.checked));
  s.append(input, el("span", "track"));
  return s;
}

function typeRow(tile, icon, title, count, body) {
  const row = el("div", "row type-row");
  const t = el("span", `tile ${tile}`);
  t.innerHTML = svg(icon);
  const text = el("div", "text");
  const head = el("div", "type-head");
  head.append(el("span", "title", title));
  if (count) head.append(count);
  text.append(head, body);
  row.append(t, text);
  return row;
}

function renderTypes() {
  const box = $("types");
  const focused = document.activeElement && document.activeElement.id === "ext-add";
  box.replaceChildren();
  const grouped = new Set();

  for (const g of GROUPS) {
    const on = g.exts.filter((e) => exts.includes(e));
    g.exts.forEach((e) => grouped.add(e));
    const name = dmT(`type_${g.id}`);

    const list = el("div", "exts");
    for (const e of g.exts) {
      const b = el("button", "ext", e);
      b.type = "button";
      b.setAttribute("aria-pressed", String(exts.includes(e)));
      b.addEventListener("click", () => {
        exts = exts.includes(e) ? exts.filter((v) => v !== e) : [...exts, e];
        renderTypes();
        saveExts();
      });
      list.append(b);
    }

    const count = el("span", "type-count", dmT("typeCount", on.length, g.exts.length));
    const all = switchEl(on.length > 0, dmT("typeToggleAll", name), (checked) => {
      exts = checked ? [...new Set([...exts, ...g.exts])] : exts.filter((v) => !g.exts.includes(v));
      renderTypes();
      saveExts();
    });
    const row = typeRow(g.tile, g.icon, name, count, list);
    row.append(all);
    box.append(row);
  }

  // Other: the user's own extensions, removable, plus an input to add more.
  const others = exts.filter((e) => !grouped.has(e));
  const list = el("div", "exts");
  for (const e of others) {
    const b = el("button", "ext", e);
    b.type = "button";
    b.setAttribute("aria-pressed", "true");
    b.title = dmT("removeExt", e);
    const x = el("span", "x");
    x.innerHTML = svg(X_ICON);
    b.append(x);
    b.addEventListener("click", () => {
      exts = exts.filter((v) => v !== e);
      renderTypes();
      saveExts();
    });
    list.append(b);
  }
  const input = el("input", "ext-add");
  input.id = "ext-add";
  input.spellcheck = false;
  input.autocomplete = "off";
  input.placeholder = dmT("extPlaceholder");
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " " || ev.key === ",") {
      ev.preventDefault();
      addExts(input.value);
    } else if (ev.key === "Backspace" && !input.value && others.length) {
      exts = exts.filter((v) => v !== others[others.length - 1]);
      renderTypes();
      saveExts();
    }
  });
  input.addEventListener("paste", (ev) => {
    ev.preventDefault();
    addExts(ev.clipboardData.getData("text"));
  });
  input.addEventListener("blur", () => input.value.trim() && addExts(input.value));
  list.append(input);
  const count = others.length ? el("span", "type-count", String(others.length)) : null;
  box.append(typeRow("slate", OTHER_ICON, dmT("type_other"), count, list));
  if (focused) $("ext-add").focus();
}

function addExts(text) {
  const before = exts.length;
  for (const part of text.split(/[\s,;]+/)) {
    const e = normalizeExt(part);
    if (e && !exts.includes(e)) exts.push(e);
  }
  const input = $("ext-add");
  if (input) input.value = "";
  if (exts.length !== before) {
    renderTypes();
    saveExts();
  }
}

// ---------- Size threshold ----------

function renderSize(mb) {
  const box = $("size-presets");
  box.replaceChildren();
  for (const v of SIZE_PRESETS) {
    const b = el("button", null, v ? `${v} MB` : dmT("sizeOff"));
    b.type = "button";
    b.setAttribute("aria-pressed", String(v === mb));
    b.addEventListener("click", () => setSize(v));
    box.append(b);
  }
  if (document.activeElement !== $("minSizeMB")) $("minSizeMB").value = mb;
}

function setSize(mb) {
  const v = Math.max(0, Math.round(Number(mb) || 0));
  renderSize(v);
  save({ minSizeMB: v });
}

$("minSizeMB").addEventListener("change", (e) => setSize(e.target.value));

// ---------- Toggles ----------

$("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
$("showVideoButton").addEventListener("change", (e) => save({ showVideoButton: e.target.checked }));

// ---------- Connection ----------

async function checkStatus() {
  setStatus("checking", dmT("statusChecking"), dmT("statusCheckingDesc"));
  $("pair").hidden = true;
  const { running, paired, settings } = await dmEnsurePaired();
  // dmEnsurePaired may have adopted the bundled token.
  if (document.activeElement !== $("token")) $("token").value = settings.token;
  if (document.activeElement !== $("port")) $("port").value = settings.port;
  if (!running) {
    setStatus("warn", dmT("optNotRunning"), dmT("optNotRunningDesc"));
  } else if (!paired) {
    setStatus("warn", dmT("tokenWrong"), dmT("tokenWrongDesc"));
    $("pair").hidden = false;
  } else {
    setStatus("ok", dmT("connected"), dmT("optConnectedDesc"));
  }
}

$("recheck").addEventListener("click", checkStatus);

$("token").addEventListener("change", async (e) => {
  await save({ token: e.target.value.trim() });
  checkStatus();
});
$("port").addEventListener("change", async (e) => {
  await save({ port: Number(e.target.value) || DM_DEFAULTS.port });
  checkStatus();
});

$("toggle-token").addEventListener("click", () => {
  const t = $("token");
  const show = t.type === "password";
  t.type = show ? "text" : "password";
  const label = dmT(show ? "hideToken" : "showToken");
  $("toggle-token").title = label;
  $("toggle-token").setAttribute("aria-label", label);
});

$("pair").addEventListener("click", async () => {
  $("pair").disabled = true;
  setStatus("checking", dmT("pairWaiting"), dmT("pairWaitingDesc"));
  const res = await ext.runtime.sendMessage({ type: "pair" });
  $("pair").disabled = false;
  if (!res?.ok) {
    setStatus("error", dmT("pairFailed"), res?.error || dmT("tryAgain"));
    $("pair").hidden = false;
    return;
  }
  checkStatus();
});

$("reset").addEventListener("click", async () => {
  if (!confirm(dmT("resetConfirm"))) return;
  const { token, port, uiLanguage } = await dmSettings();
  await ext.storage.local.clear();
  await save({ token, port, ...(uiLanguage ? { uiLanguage } : {}) });
  load();
});

// ---------- Load ----------

async function load() {
  const s = await dmSettings();
  $("token").value = s.token;
  $("port").value = s.port;
  $("enabled").checked = s.enabled;
  $("showVideoButton").checked = s.showVideoButton;
  exts = [...new Set(s.extensions.split(/\s+/).map(normalizeExt).filter(Boolean))];
  renderTypes();
  renderSize(Number(s.minSizeMB) || 0);
  checkStatus();
}

$("version").textContent = "v" + ext.runtime.getManifest().version;

// The language the page was drawn in. When the app switches language while
// this page is open (dmPing in checkStatus() stores it), redraw everything.
let shownLang = null;
ext.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.uiLanguage) return;
  const next = changes.uiLanguage.newValue; // undefined: storage cleared, not a switch
  if (shownLang && next && next !== shownLang) location.reload();
});

// Texts follow the app's language: load it before drawing anything.
dmI18nReady()
  .then(() => {
    shownLang = dmUiLanguage();
    dmApplyI18n();
    return load();
  })
  .finally(() => {
    void document.body.offsetWidth; // flush styles so the initial toggle state is not animated
    document.body.classList.add("ready");
  });

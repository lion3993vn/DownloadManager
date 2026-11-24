import { useEffect, useState, type ReactNode } from "react";
import { api, outdatedExtensions, type BrowserInfo, type ConnectedExtension, type ExtensionSetupInfo } from "../lib/api";
import { Modal } from "./Modal";
import { CheckCircleIcon, CheckIcon, ClipboardIcon, FolderIcon, GlobeIcon, InfoIcon, OpenIcon, PuzzleIcon } from "./Icons";

interface Props {
  connected: ConnectedExtension[];
  /** Version bundled with the app: connected extensions below it need a reload. */
  bundledVersion: string | null;
  onClose: () => void;
  onError: (msg: string) => void;
}

const GLYPH: Record<string, string> = {
  chrome: "from-red-500 via-amber-400 to-green-500",
  chromium: "from-sky-500 to-blue-600",
  edge: "from-sky-500 to-teal-400",
  coccoc: "from-green-500 to-emerald-700",
  brave: "from-orange-500 to-red-500",
  opera: "from-red-600 to-rose-500",
  vivaldi: "from-rose-500 to-red-600",
  firefox: "from-orange-500 via-pink-500 to-purple-600",
};

function BrowserGlyph({ b, size = "h-9 w-9" }: { b: BrowserInfo; size?: string }) {
  const letter = b.name === "Cốc Cốc" ? "C" : b.name.replace(/^(Google|Microsoft) /, "")[0];
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[14px] font-bold text-white shadow-sm ${GLYPH[b.id] ?? "from-slate-500 to-slate-700"}`}>
      {letter}
    </div>
  );
}

function Step({ n, done, title, children }: { n: number; done?: boolean; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="group relative flex gap-3.5 pb-5 last:pb-0">
      <span className="absolute top-8 bottom-0 left-[13px] w-px bg-line group-last:hidden" />
      <span
        className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
          done ? "bg-emerald-500 text-white" : "border border-line-strong bg-card text-ink-2"
        }`}
      >
        {done ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {children && <div className="mt-1.5 text-[12.5px] leading-relaxed text-mute">{children}</div>}
      </div>
    </li>
  );
}

function PathBox({ path, onCopy, copied, onReveal }: { path: string; onCopy: () => void; copied: string | null; onReveal: () => void }) {
  const isCopied = copied === path;
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-panel p-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2 select-text" title={path}>
        {path}
      </code>
      <button className="btn-outline px-2.5 py-1 text-[12px]" onClick={onCopy}>
        {isCopied ? <CheckIcon className="text-emerald-500" /> : <ClipboardIcon />} {isCopied ? "Đã chép" : "Chép"}
      </button>
      <button className="btn-ghost px-2 py-1" onClick={onReveal} title="Mở thư mục">
        <FolderIcon />
      </button>
    </div>
  );
}

/** Kbd-styled label for browser UI elements. */
const K = ({ children }: { children: ReactNode }) => (
  <span className="rounded-md border border-line bg-panel px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap text-ink-2">{children}</span>
);

export function ExtensionWizard({ connected, bundledVersion, onClose, onError }: Props) {
  const outdated = outdatedExtensions(connected, bundledVersion);
  const outdatedFor = (b: BrowserInfo) => outdated.find((e) => e.browser === b.name) ?? null;
  const [info, setInfo] = useState<ExtensionSetupInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api
      .extensionSetupInfo()
      .then((i) => {
        setInfo(i);
        const needsUpdate = i.browsers.find((b) => outdated.some((e) => e.browser === b.name));
        const notConnected = i.browsers.find((b) => !connected.some((c) => c.browser === b.name));
        setSelected((needsUpdate ?? notConnected ?? i.browsers[0])?.id ?? null);
      })
      .catch((e) => onError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const browser = info?.browsers.find((b) => b.id === selected) ?? null;
  const isConnected = (b: BrowserInfo) => connected.some((c) => c.browser === b.name);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      /* ignore */
    }
  }

  async function openBrowser(b: BrowserInfo) {
    // Chromium blocks chrome:// URLs from outside, so put the address on the
    // clipboard; Firefox opens about:debugging itself, so copy the manifest path.
    await copy(b.engine === "firefox" ? info!.manifestPath : b.extensionsUrl);
    try {
      await api.openBrowserExtensions(b.id);
      setOpened((o) => ({ ...o, [b.id]: true }));
    } catch (e) {
      onError(String(e));
    }
  }

  const reveal = () => api.revealExtensionFolder().catch((e) => onError(String(e)));
  const done = browser ? isConnected(browser) : false;

  return (
    <Modal
      title="Kết nối trình duyệt"
      subtitle="Cài extension để DownloadManager tự bắt mọi lượt tải từ trình duyệt."
      icon={<PuzzleIcon />}
      onClose={onClose}
      width="max-w-[780px]"
      flush
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-[12px] text-mute">
            <InfoIcon className="h-3.5 w-3.5" /> Extension tự ghép cặp với app — không cần nhập mã.
          </span>
          <button className="btn-primary" onClick={onClose}>
            {connected.length ? "Xong" : "Để sau"}
          </button>
        </>
      }
    >
      {!info ? (
        <div className="px-6 py-16 text-center text-mute">Đang chuẩn bị extension…</div>
      ) : (
        <div className="grid min-h-[380px] grid-cols-[230px_minmax(0,1fr)] border-t border-line">
          {/* Browser picker */}
          <div className="space-y-1 border-r border-line bg-panel/50 p-3">
            <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">Trình duyệt trên máy</p>
            {info.browsers.length === 0 && <p className="px-2 text-[12px] text-mute">Không tìm thấy trình duyệt quen thuộc.</p>}
            {info.browsers.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelected(b.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                  selected === b.id ? "bg-card shadow-card ring-1 ring-line" : "hover:bg-ink/[0.045]"
                }`}
              >
                <BrowserGlyph b={b} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{b.name}</span>
                  {outdatedFor(b) ? (
                    <span className="block text-[11px] text-amber-600 dark:text-amber-400">● Cần cập nhật</span>
                  ) : (
                    <span className={`block text-[11px] ${isConnected(b) ? "text-emerald-600" : "text-mute"}`}>
                      {isConnected(b) ? "● Đã kết nối" : "Chưa cài"}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {/* Steps */}
          <div className="min-w-0 p-6">
            {!browser ? (
              <GenericSteps folder={info.folder} copied={copied} onCopy={() => copy(info.folder)} onReveal={reveal} />
            ) : outdatedFor(browser) ? (
              <UpdateSteps
                browser={browser}
                current={outdatedFor(browser)!.version}
                latest={bundledVersion!}
                opened={opened[browser.id]}
                copied={copied}
                folder={info.folder}
                manifestPath={info.manifestPath}
                onOpen={() => openBrowser(browser)}
                onCopy={copy}
                onReveal={reveal}
              />
            ) : done ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-500">
                  <CheckCircleIcon className="h-9 w-9" />
                </div>
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{browser.name} đã kết nối</h3>
                <p className="mt-1 max-w-sm text-[12.5px] text-mute">
                  Từ giờ các tệp tải từ {browser.name} sẽ tự chuyển sang DownloadManager. Nếu app không chạy, trình duyệt vẫn tải như bình
                  thường.
                </p>
              </div>
            ) : browser.engine === "chromium" ? (
              <ol>
                <Step n={1} done={opened[browser.id]} title={`Mở trang tiện ích của ${browser.name}`}>
                  <button className="btn-primary mt-0.5" onClick={() => openBrowser(browser)}>
                    <OpenIcon /> Mở {browser.name}
                  </button>
                  <p className="mt-2">
                    {copied === browser.extensionsUrl ? (
                      <span className="text-emerald-600 dark:text-emerald-400">Đã chép địa chỉ <K>{browser.extensionsUrl}</K>. </span>
                    ) : (
                      <>App sẽ chép sẵn địa chỉ <K>{browser.extensionsUrl}</K>. </>
                    )}
                    Trong cửa sổ vừa mở: dán vào thanh địa chỉ <K>Ctrl V</K> rồi nhấn <K>Enter</K>.
                  </p>
                </Step>
                <Step n={2} title={<>Bật <K>Chế độ dành cho nhà phát triển</K> (Developer mode)</>}>
                  Công tắc ở góc trên bên phải trang tiện ích{browser.id === "edge" ? " (Edge: ở cột bên trái)" : ""}.
                </Step>
                <Step n={3} title={<>Bấm <K>Tải tiện ích đã giải nén</K> (Load unpacked) và chọn thư mục này</>}>
                  Bấm <b className="font-medium text-ink-2">Chép</b>, rồi trong hộp chọn thư mục dán <K>Ctrl V</K> vào ô địa chỉ và bấm <K>Chọn thư mục</K>.
                  <PathBox path={info.folder} copied={copied} onCopy={() => copy(info.folder)} onReveal={reveal} />
                </Step>
                <Step n={4} title="Chờ kết nối">
                  <Waiting />
                </Step>
              </ol>
            ) : (
              <ol>
                <Step n={1} done={opened[browser.id]} title="Mở trang gỡ lỗi tiện ích của Firefox">
                  <button className="btn-primary mt-0.5" onClick={() => openBrowser(browser)}>
                    <OpenIcon /> Mở Firefox
                  </button>
                </Step>
                <Step n={2} title={<>Bấm <K>Load Temporary Add-on…</K> và chọn tệp manifest.json</>}>
                  Đường dẫn đã được chép sẵn khi mở Firefox — dán vào ô tên tệp:
                  <PathBox path={info.manifestPath} copied={copied} onCopy={() => copy(info.manifestPath)} onReveal={reveal} />
                </Step>
                <Step n={3} title="Chờ kết nối">
                  <Waiting />
                  <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
                    Firefox chỉ cho cài tạm extension chưa được Mozilla ký — sẽ tự gỡ khi tắt Firefox. Nên dùng Chrome/Edge/Cốc Cốc để dùng lâu dài.
                  </p>
                </Step>
              </ol>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Waiting() {
  return (
    <div>
      <span className="inline-flex items-center gap-2 text-[12.5px] text-mute">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
        Đang chờ extension kết nối với app…
      </span>
      <p className="mt-1.5 text-[12px] text-mute">
        Đã cài mà chưa thấy? Bấm biểu tượng <b className="font-medium text-ink-2">DownloadManager</b> trên thanh công cụ của trình duyệt
        (hình mảnh ghép 🧩 nếu đang bị ẩn) để kết nối ngay.
      </p>
    </div>
  );
}

function GenericSteps({ folder, copied, onCopy, onReveal }: { folder: string; copied: string | null; onCopy: () => void; onReveal: () => void }) {
  return (
    <ol>
      <Step n={1} title="Mở trang quản lý tiện ích của trình duyệt">
        <span className="flex items-center gap-1.5">
          <GlobeIcon className="h-3.5 w-3.5" /> Chrome: <K>chrome://extensions</K> · Edge: <K>edge://extensions</K>
        </span>
      </Step>
      <Step n={2} title={<>Bật <K>Developer mode</K> rồi bấm <K>Load unpacked</K></>} />
      <Step n={3} title="Chọn thư mục extension">
        <PathBox path={folder} copied={copied} onCopy={onCopy} onReveal={onReveal} />
      </Step>
    </ol>
  );
}

/** After this long without the new version, show the manual steps. */
const MANUAL_UPDATE_AFTER_MS = 60_000;

/**
 * The extension folder already holds the new version (the app refreshes it on
 * every start). The extension notices the newer files on disk and reloads
 * itself (`dmSelfUpdate`: every 30 s, on page loads and when the popup opens),
 * so this panel mostly waits. The manual reload is the fallback, for very old
 * extensions or a copy installed from another folder.
 */
function UpdateSteps(p: {
  browser: BrowserInfo;
  current: string | null;
  latest: string;
  opened?: boolean;
  copied: string | null;
  folder: string;
  manifestPath: string;
  onOpen: () => void;
  onCopy: (text: string) => void;
  onReveal: () => void;
}) {
  const firefox = p.browser.engine === "firefox";
  const [manual, setManual] = useState(false);
  useEffect(() => {
    setManual(false);
    const t = setTimeout(() => setManual(true), MANUAL_UPDATE_AFTER_MS);
    return () => clearTimeout(t);
  }, [p.browser.id]);

  return (
    <div>
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-brand/30 bg-brand/8 p-3.5">
        <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
        <div className="text-[12.5px] leading-relaxed text-ink-2">
          <b className="font-semibold text-ink">Extension trên {p.browser.name} đang tự cập nhật</b>
          <span className="block text-mute">
            {p.current ? <K>v{p.current}</K> : "Bản cũ"} → <K>v{p.latest}</K> · không cần làm gì, thường xong trong khoảng 30 giây khi{" "}
            {p.browser.name} đang mở.
          </span>
          <span className="mt-1.5 block text-mute">
            Muốn nhanh hơn: mở hoặc tải lại một trang web bất kỳ trong {p.browser.name}, hoặc bấm biểu tượng{" "}
            <b className="font-medium text-ink-2">DownloadManager</b> trên thanh công cụ.
          </span>
        </div>
      </div>
      {!manual ? (
        <button className="btn-ghost px-2 py-1 text-[12px] text-mute" onClick={() => setManual(true)}>
          Chưa thấy cập nhật? Làm thủ công
        </button>
      ) : (
        <ManualUpdateSteps {...p} firefox={firefox} />
      )}
    </div>
  );
}

/** The old flow: reload the extension by hand in the browser's extension page. */
function ManualUpdateSteps(p: Parameters<typeof UpdateSteps>[0] & { firefox: boolean }) {
  const firefox = p.firefox;
  return (
    <div>
      <p className="mb-3 text-[12.5px] text-mute">Vẫn chưa được? Tải lại extension bằng tay (chỉ cần một lần):</p>
      <ol>
        <Step n={1} done={p.opened} title={firefox ? "Mở trang gỡ lỗi tiện ích của Firefox" : `Mở trang tiện ích của ${p.browser.name}`}>
          <button className="btn-primary mt-0.5" onClick={p.onOpen}>
            <OpenIcon /> Mở {p.browser.name}
          </button>
          {!firefox && (
            <p className="mt-2">
              App sẽ chép sẵn địa chỉ <K>{p.browser.extensionsUrl}</K>, dán vào thanh địa chỉ <K>Ctrl V</K> rồi nhấn <K>Enter</K>.
            </p>
          )}
        </Step>
        <Step
          n={2}
          title={
            firefox ? (
              <>Bấm <K>Reload</K> ở mục DownloadManager Connector</>
            ) : (
              <>Bấm nút tải lại <K>↻</K> trên thẻ DownloadManager Connector</>
            )
          }
        >
          Từ bản này trở đi, extension tự cập nhật mỗi khi app có bản mới.
        </Step>
        <Step n={3} title="Chờ extension báo phiên bản mới">
          <p>
            Vẫn báo cũ? Có thể extension được cài từ thư mục khác. Gỡ nó đi rồi cài lại từ{" "}
            {firefox ? "tệp manifest.json" : "thư mục"} này:
          </p>
          <PathBox
            path={firefox ? p.manifestPath : p.folder}
            copied={p.copied}
            onCopy={() => p.onCopy(firefox ? p.manifestPath : p.folder)}
            onReveal={p.onReveal}
          />
        </Step>
      </ol>
    </div>
  );
}

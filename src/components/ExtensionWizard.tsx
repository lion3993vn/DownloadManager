import { Fragment, useEffect, useState, type ReactNode } from "react";
import { api, outdatedExtensions, type BrowserInfo, type ConnectedExtension, type ExtensionSetupInfo } from "../lib/api";
import { useT } from "../i18n";
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

/** Fill `{name}` placeholders of a translated string with React nodes. */
function rich(text: string, nodes: Record<string, ReactNode>): ReactNode {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{name && name in nodes ? nodes[name] : part}</Fragment>;
  });
}

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
  const t = useT();
  const isCopied = copied === path;
  return (
    <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-panel p-1.5 pl-3">
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2 select-text" title={path}>
        {path}
      </code>
      <button className="btn-outline px-2.5 py-1 text-[12px]" onClick={onCopy}>
        {isCopied ? <CheckIcon className="text-emerald-500" /> : <ClipboardIcon />} {isCopied ? t("common.copied") : t("common.copy")}
      </button>
      <button className="btn-ghost px-2 py-1" onClick={onReveal} title={t("wizard.openFolder")}>
        <FolderIcon />
      </button>
    </div>
  );
}

/** Kbd-styled label for browser UI elements. */
const K = ({ children }: { children: ReactNode }) => (
  <span className="rounded-md border border-line bg-panel px-1.5 py-px text-[11.5px] font-medium whitespace-nowrap text-ink-2">{children}</span>
);

/** Bold app/button name inside a sentence. */
const B = ({ children }: { children: ReactNode }) => <b className="font-medium text-ink-2">{children}</b>;

const PASTE_KEYS = { paste: <K>Ctrl V</K>, enter: <K>Enter</K> };

export function ExtensionWizard({ connected, bundledVersion, onClose, onError }: Props) {
  const t = useT();
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
      title={t("wizard.title")}
      subtitle={t("wizard.subtitle")}
      icon={<PuzzleIcon />}
      onClose={onClose}
      width="max-w-[780px]"
      flush
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-[12px] text-mute">
            <InfoIcon className="h-3.5 w-3.5" /> {t("wizard.autoPair")}
          </span>
          <button className="btn-primary" onClick={onClose}>
            {connected.length ? t("wizard.done") : t("wizard.later")}
          </button>
        </>
      }
    >
      {!info ? (
        <div className="px-6 py-16 text-center text-mute">{t("wizard.preparing")}</div>
      ) : (
        <div className="grid min-h-[380px] grid-cols-[230px_minmax(0,1fr)] border-t border-line">
          {/* Browser picker */}
          <div className="space-y-1 border-r border-line bg-panel/50 p-3">
            <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{t("wizard.browsers")}</p>
            {info.browsers.length === 0 && <p className="px-2 text-[12px] text-mute">{t("wizard.noBrowsers")}</p>}
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
                    <span className="block text-[11px] text-amber-600 dark:text-amber-400">{t("wizard.needsUpdate")}</span>
                  ) : (
                    <span className={`block text-[11px] ${isConnected(b) ? "text-emerald-600" : "text-mute"}`}>
                      {isConnected(b) ? t("wizard.connected") : t("wizard.notInstalled")}
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
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{t("wizard.connectedTitle", { name: browser.name })}</h3>
                <p className="mt-1 max-w-sm text-[12.5px] text-mute">{t("wizard.connectedBody", { name: browser.name })}</p>
              </div>
            ) : browser.engine === "chromium" ? (
              <ol>
                <Step n={1} done={opened[browser.id]} title={t("wizard.openExtPage", { name: browser.name })}>
                  <button className="btn-primary mt-0.5" onClick={() => openBrowser(browser)}>
                    <OpenIcon /> {t("wizard.open", { name: browser.name })}
                  </button>
                  <p className="mt-2">
                    {copied === browser.extensionsUrl ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {rich(t("wizard.urlCopied"), { url: <K>{browser.extensionsUrl}</K> })}
                      </span>
                    ) : (
                      rich(t("wizard.urlWillCopy"), { url: <K>{browser.extensionsUrl}</K> })
                    )}
                    {rich(t("wizard.pasteUrl"), PASTE_KEYS)}
                  </p>
                </Step>
                <Step n={2} title={rich(t("wizard.devModeStep"), { devMode: <K>{t("wizard.devModeLabel")}</K> })}>
                  {browser.id === "edge" ? t("wizard.devModeHintEdge") : t("wizard.devModeHint")}
                </Step>
                <Step n={3} title={rich(t("wizard.loadUnpackedStep"), { loadUnpacked: <K>{t("wizard.loadUnpackedLabel")}</K> })}>
                  {rich(t("wizard.loadUnpackedHint"), {
                    copy: <B>{t("common.copy")}</B>,
                    paste: <K>Ctrl V</K>,
                    selectFolder: <K>{t("wizard.selectFolder")}</K>,
                  })}
                  <PathBox path={info.folder} copied={copied} onCopy={() => copy(info.folder)} onReveal={reveal} />
                </Step>
                <Step n={4} title={t("wizard.waitStep")}>
                  <Waiting />
                </Step>
              </ol>
            ) : (
              <ol>
                <Step n={1} done={opened[browser.id]} title={t("wizard.ffOpenPage")}>
                  <button className="btn-primary mt-0.5" onClick={() => openBrowser(browser)}>
                    <OpenIcon /> {t("wizard.open", { name: "Firefox" })}
                  </button>
                </Step>
                <Step n={2} title={rich(t("wizard.ffLoadStep"), { loadTemp: <K>Load Temporary Add-on…</K> })}>
                  {t("wizard.ffPathHint")}
                  <PathBox path={info.manifestPath} copied={copied} onCopy={() => copy(info.manifestPath)} onReveal={reveal} />
                </Step>
                <Step n={3} title={t("wizard.waitStep")}>
                  <Waiting />
                  <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
                    {t("wizard.ffTemporary")}
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
  const t = useT();
  return (
    <div>
      <span className="inline-flex items-center gap-2 text-[12.5px] text-mute">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
        {t("wizard.waiting")}
      </span>
      <p className="mt-1.5 text-[12px] text-mute">{rich(t("wizard.waitingHint"), { app: <B>DownloadManager</B> })}</p>
    </div>
  );
}

function GenericSteps({ folder, copied, onCopy, onReveal }: { folder: string; copied: string | null; onCopy: () => void; onReveal: () => void }) {
  const t = useT();
  return (
    <ol>
      <Step n={1} title={t("wizard.genericOpen")}>
        <span className="flex items-center gap-1.5">
          <GlobeIcon className="h-3.5 w-3.5" /> Chrome: <K>chrome://extensions</K> · Edge: <K>edge://extensions</K>
        </span>
      </Step>
      <Step n={2} title={rich(t("wizard.genericDevMode"), { devMode: <K>Developer mode</K>, loadUnpacked: <K>Load unpacked</K> })} />
      <Step n={3} title={t("wizard.genericFolder")}>
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
  const t = useT();
  const firefox = p.browser.engine === "firefox";
  const [manual, setManual] = useState(false);
  useEffect(() => {
    setManual(false);
    const timer = setTimeout(() => setManual(true), MANUAL_UPDATE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [p.browser.id]);

  return (
    <div>
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-brand/30 bg-brand/8 p-3.5">
        <span className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
        <div className="text-[12.5px] leading-relaxed text-ink-2">
          <b className="font-semibold text-ink">{t("wizard.updating", { name: p.browser.name })}</b>
          <span className="block text-mute">
            {rich(t("wizard.updatingBody", { name: p.browser.name }), {
              from: p.current ? <K>v{p.current}</K> : t("wizard.oldVersion"),
              to: <K>v{p.latest}</K>,
            })}
          </span>
          <span className="mt-1.5 block text-mute">
            {rich(t("wizard.updatingFaster", { name: p.browser.name }), { app: <B>DownloadManager</B> })}
          </span>
        </div>
      </div>
      {!manual ? (
        <button className="btn-ghost px-2 py-1 text-[12px] text-mute" onClick={() => setManual(true)}>
          {t("wizard.manualButton")}
        </button>
      ) : (
        <ManualUpdateSteps {...p} firefox={firefox} />
      )}
    </div>
  );
}

/** The old flow: reload the extension by hand in the browser's extension page. */
function ManualUpdateSteps(p: Parameters<typeof UpdateSteps>[0] & { firefox: boolean }) {
  const t = useT();
  const firefox = p.firefox;
  return (
    <div>
      <p className="mb-3 text-[12.5px] text-mute">{t("wizard.manualIntro")}</p>
      <ol>
        <Step n={1} done={p.opened} title={firefox ? t("wizard.ffOpenPage") : t("wizard.openExtPage", { name: p.browser.name })}>
          <button className="btn-primary mt-0.5" onClick={p.onOpen}>
            <OpenIcon /> {t("wizard.open", { name: p.browser.name })}
          </button>
          {!firefox && (
            <p className="mt-2">{rich(t("wizard.manualPaste"), { url: <K>{p.browser.extensionsUrl}</K>, ...PASTE_KEYS })}</p>
          )}
        </Step>
        <Step
          n={2}
          title={
            firefox
              ? rich(t("wizard.ffReload"), { reload: <K>Reload</K> })
              : rich(t("wizard.reloadCard"), { icon: <K>↻</K> })
          }
        >
          {t("wizard.selfUpdateNote")}
        </Step>
        <Step n={3} title={t("wizard.waitVersion")}>
          <p>{firefox ? t("wizard.reinstallFile") : t("wizard.reinstallFolder")}</p>
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

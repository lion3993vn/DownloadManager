import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type BridgeStatus, type Settings } from "../lib/api";
import type { ThemePref } from "../lib/theme";
import { Field, Modal, Switch } from "./Modal";
import {
  AppIcon,
  ArchiveIcon,
  BoltIcon,
  CopyIcon,
  DocIcon,
  DownloadIcon,
  ImageIcon,
  MusicIcon,
  FolderIcon,
  InfoIcon,
  MonitorIcon,
  MoonIcon,
  PuzzleIcon,
  RefreshIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  VideoIcon,
} from "./Icons";
import { MediaToolsPanel } from "./MediaTools";
import { LANGUAGES, normalizePref, setLanguagePref, useT, type MessageKey } from "../i18n";

interface Props {
  theme: ThemePref;
  onTheme: (t: ThemePref) => void;
  onClose: () => void;
  onSaved: (s: Settings) => void;
  onError: (msg: string) => void;
  onInstallExtension: () => void;
  onTokenRegenerated: () => void;
  version: string;
  onChangelog: () => void;
}

type Tab = "download" | "auto" | "video" | "browser" | "app" | "about";
type IconT = ComponentType<SVGProps<SVGSVGElement>>;

const TABS: { key: Tab; label: MessageKey; icon: IconT }[] = [
  { key: "download", label: "settings.tab.download", icon: DownloadIcon },
  { key: "auto", label: "settings.tab.auto", icon: BoltIcon },
  { key: "video", label: "settings.tab.video", icon: VideoIcon },
  { key: "browser", label: "settings.tab.browser", icon: PuzzleIcon },
  { key: "app", label: "settings.tab.app", icon: SettingsIcon },
  { key: "about", label: "settings.tab.about", icon: InfoIcon },
];

/** Per-type folders ("sort by type"); defaults match categories.rs. */
const CATEGORIES: { key: string; label: MessageKey; icon: IconT; folder: string }[] = [
  { key: "video", label: "sidebar.type.video", icon: VideoIcon, folder: "Video" },
  { key: "audio", label: "sidebar.type.audio", icon: MusicIcon, folder: "Music" },
  { key: "archive", label: "sidebar.type.archive", icon: ArchiveIcon, folder: "Compressed" },
  { key: "document", label: "sidebar.type.document", icon: DocIcon, folder: "Documents" },
  { key: "program", label: "sidebar.type.program", icon: AppIcon, folder: "Programs" },
  { key: "image", label: "sidebar.type.image", icon: ImageIcon, folder: "Images" },
];

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 mb-1 text-[11.5px] font-semibold tracking-wide text-mute uppercase first:mt-0">{children}</h3>;
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-3.5 last:border-0">
      <div>
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {hint && <div className="mt-0.5 text-[12px] text-mute">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Stepper({ value, min, max, onChange, suffix }: { value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div className="flex items-center rounded-lg border border-line bg-card">
      <button type="button" className="h-8 w-8 text-mute hover:text-ink" onClick={() => onChange(clamp(value - 1))}>
        −
      </button>
      <input
        className="w-12 bg-transparent text-center text-[13px] font-medium tabular-nums outline-none"
        value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, "")) || min))}
      />
      {suffix && <span className="pr-1 text-[12px] text-mute">{suffix}</span>}
      <button type="button" className="h-8 w-8 text-mute hover:text-ink" onClick={() => onChange(clamp(value + 1))}>
        +
      </button>
    </div>
  );
}

export function SettingsDialog({ theme, onTheme, onClose, onSaved, onError, onInstallExtension, onTokenRegenerated, version, onChangelog }: Props) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("download");
  const [s, setS] = useState<Settings | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [limitOn, setLimitOn] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((v) => {
        // Settings saved before the language option existed have no value.
        setS({ ...v, app: { ...v.app, language: normalizePref(v.app.language) } });
        setLimitOn(v.engine.speedLimit > 0);
      })
      .catch((e) => onError(String(e)));
    api.bridgeStatus().then(setBridge);
  }, [onError]);

  if (!s) return null;
  const eng = s.engine;
  const setEngine = (patch: Partial<Settings["engine"]>) => setS({ ...s, engine: { ...eng, ...patch } });
  const setApp = (patch: Partial<Settings["app"]>) => setS({ ...s, app: { ...s.app, ...patch } });

  async function save() {
    try {
      const toSave = { ...s!, engine: { ...s!.engine, speedLimit: limitOn ? Math.max(s!.engine.speedLimit, 1024) : 0 } };
      const saved = await api.saveSettings(toSave);
      setLanguagePref(normalizePref(saved.app.language));
      onSaved(saved);
      onClose();
    } catch (e) {
      onError(String(e));
    }
  }

  return (
    <Modal
      title={t("settings.title")}
      icon={<SettingsIcon />}
      onClose={onClose}
      width="max-w-[720px]"
      flush
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn-primary min-w-[96px]" onClick={save}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="grid min-h-[400px] grid-cols-[180px_minmax(0,1fr)] border-t border-line">
        <nav className="space-y-0.5 border-r border-line bg-panel/50 p-3">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition ${
                tab === key ? "bg-card font-medium text-ink shadow-card" : "text-ink-2 hover:bg-ink/[0.045]"
              }`}
            >
              <Icon className={`h-4 w-4 ${tab === key ? "text-brand" : "text-mute"}`} /> {t(label)}
            </button>
          ))}
        </nav>

        <div className="@container px-6 py-4">
          {tab === "video" && <MediaToolsPanel onError={onError} />}
          {tab === "download" && (
            <>
              <Field label={t("settings.downloadDir")}>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <FolderIcon className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
                    <input className="field pl-10" value={eng.downloadDir} onChange={(e) => setEngine({ downloadDir: e.target.value })} />
                  </div>
                  <button
                    className="btn-outline"
                    onClick={async () => {
                      const dir = await open({ directory: true, defaultPath: eng.downloadDir });
                      if (typeof dir === "string") setEngine({ downloadDir: dir });
                    }}
                  >
                    {t("settings.browse")}
                  </button>
                </div>
              </Field>
              <div className="mt-3">
                <Row title={t("settings.connections")} hint={t("settings.connectionsHint")}>
                  <Stepper value={eng.connections} min={1} max={32} onChange={(v) => setEngine({ connections: v })} />
                </Row>
                <Row title={t("settings.maxConcurrent")} hint={t("settings.maxConcurrentHint")}>
                  <Stepper value={eng.maxConcurrent} min={1} max={20} onChange={(v) => setEngine({ maxConcurrent: v })} />
                </Row>
                <Row title={t("settings.speedLimit")} hint={t("settings.speedLimitHint")}>
                  <div className="flex items-center gap-3">
                    {limitOn && (
                      <div className="flex items-center gap-1.5">
                        <input
                          className="field w-24 py-1.5 text-right tabular-nums"
                          value={Math.round(eng.speedLimit / 1024) || ""}
                          placeholder="1024"
                          onChange={(e) => setEngine({ speedLimit: (Number(e.target.value.replace(/\D/g, "")) || 0) * 1024 })}
                        />
                        <span className="text-[12px] text-mute">KB/s</span>
                      </div>
                    )}
                    <Switch
                      checked={limitOn}
                      onChange={(v) => {
                        setLimitOn(v);
                        if (v && !eng.speedLimit) setEngine({ speedLimit: 1024 * 1024 });
                      }}
                    />
                  </div>
                </Row>
              </div>
            </>
          )}

          {tab === "auto" && (
            <>
              <SectionTitle>{t("settings.clipboardHeading")}</SectionTitle>
              <Row title={t("settings.clipboard")} hint={t("settings.clipboardHint")}>
                <Switch checked={s.app.clipboardMonitor} onChange={(v) => setApp({ clipboardMonitor: v })} />
              </Row>
              {s.app.clipboardMonitor && (
                <Row title={t("settings.clipboardMedia")} hint={t("settings.clipboardMediaHint")}>
                  <Switch checked={s.app.clipboardMedia} onChange={(v) => setApp({ clipboardMedia: v })} />
                </Row>
              )}

              <SectionTitle>{t("settings.sortHeading")}</SectionTitle>
              <Row title={t("settings.sortByType")} hint={t("settings.sortByTypeHint")}>
                <Switch checked={s.app.sortByType} onChange={(v) => setApp({ sortByType: v })} />
              </Row>
              {s.app.sortByType && (
                <div className="mt-1 mb-2">
                  <div className="grid grid-cols-1 gap-2 @[560px]:grid-cols-2">
                    {CATEGORIES.map(({ key, label, icon: Icon, folder }) => (
                      <label key={key} className="flex items-center gap-2.5 rounded-lg border border-line bg-panel/50 py-1.5 pr-1.5 pl-3">
                        <Icon className="h-4 w-4 shrink-0 text-mute" />
                        <span className="w-24 shrink-0 truncate text-[12.5px] text-ink-2">{t(label)}</span>
                        <input
                          className="field min-w-0 py-1 text-[12.5px]"
                          value={s.app.categoryDirs[key] ?? ""}
                          placeholder={folder}
                          onChange={(e) => setApp({ categoryDirs: { ...s.app.categoryDirs, [key]: e.target.value } })}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-mute">{t("settings.categoryDirsHint", { dir: eng.downloadDir })}</p>
                </div>
              )}

              <SectionTitle>{t("settings.afterHeading")}</SectionTitle>
              <Row title={t("settings.extractZip")} hint={t("settings.extractZipHint")}>
                <Switch checked={s.app.extractZip} onChange={(v) => setApp({ extractZip: v })} />
              </Row>
              <p className="mt-2 rounded-lg bg-panel/60 px-3 py-2 text-[12px] text-mute">{t("settings.whenDoneHint")}</p>
            </>
          )}

          {tab === "browser" && (
            <>
              <div className="flex items-center gap-3 rounded-xl border border-line bg-panel/60 p-4">
                <span className={`h-2.5 w-2.5 rounded-full ${bridge?.running ? "bg-emerald-500" : "bg-red-500"}`} />
                <div className="flex-1">
                  <div className="text-[13px] font-medium">{bridge?.running ? t("settings.bridgeRunning") : t("settings.bridgeStopped")}</div>
                  <div className="text-[12px] text-mute">
                    {bridge?.running ? t("settings.bridgeLocal", { port: bridge.port }) : (bridge?.error ?? "")}
                  </div>
                </div>
                <button
                  className="btn-primary"
                  onClick={() => {
                    onClose();
                    onInstallExtension();
                  }}
                >
                  <PuzzleIcon /> {t("settings.installExtension")}
                </button>
              </div>
              <div className="mt-2">
                <Row title={t("settings.confirmCaptures")} hint={t("settings.confirmCapturesHint")}>
                  <Switch checked={s.app.confirmCaptures} onChange={(v) => setApp({ confirmCaptures: v })} />
                </Row>
              </div>
              <Field
                label={t("settings.token")}
                hint={t("settings.tokenHint")}
              >
                <div className="flex gap-2">
                  <input readOnly className="field font-mono text-[12px]" value={s.app.bridgeToken} />
                  <button
                    className="btn-outline"
                    onClick={async () => {
                      await navigator.clipboard.writeText(s.app.bridgeToken);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    <CopyIcon /> {copied ? t("common.copied") : t("common.copy")}
                  </button>
                  <button
                    className="btn-outline px-2.5"
                    title={t("settings.newToken")}
                    onClick={async () => {
                      setApp({ bridgeToken: await api.regenerateToken() });
                      onTokenRegenerated();
                    }}
                  >
                    <RefreshIcon />
                  </button>
                </div>
              </Field>
            </>
          )}

          {tab === "app" && (
            <>
              <Field label={t("settings.language")}>
                <div className="flex gap-1 rounded-lg bg-panel p-1">
                  {[{ value: "auto", label: t("settings.languageAuto") }, ...LANGUAGES].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setApp({ language: value })}
                      aria-pressed={s.app.language === value}
                      className={`flex-1 rounded-md py-1.5 text-[12.5px] font-medium transition ${
                        s.app.language === value ? "bg-card text-brand shadow-card" : "text-mute hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="mt-4" />
              <Field label={t("settings.theme")}>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["system", "settings.themeSystem", MonitorIcon],
                      ["light", "settings.themeLight", SunIcon],
                      ["dark", "settings.themeDark", MoonIcon],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      onClick={() => onTheme(key)}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-[12.5px] transition ${
                        theme === key ? "border-brand bg-brand/5 font-medium text-brand ring-4 ring-brand/10" : "border-line text-ink-2 hover:border-line-strong"
                      }`}
                    >
                      <Icon className="h-5 w-5" /> {t(label)}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="mt-3">
                <Row title={t("settings.autostart")} hint={t("settings.autostartHint")}>
                  <Switch checked={s.autostart} onChange={(v) => setS({ ...s, autostart: v })} />
                </Row>
                <Row title={t("settings.closeToTray")} hint={t("settings.closeToTrayHint")}>
                  <Switch checked={s.app.closeToTray} onChange={(v) => setApp({ closeToTray: v })} />
                </Row>
              </div>
            </>
          )}

          {tab === "about" && (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-lg shadow-brand/30">
                <DownloadIcon className="h-8 w-8" strokeWidth={2.4} />
              </div>
              <h3 className="mt-4 text-[17px] font-semibold">DownloadManager</h3>
              <p className="text-[12px] text-mute">{t("settings.version", { version: version || "…" })}</p>
              <button
                className="btn-primary mt-4"
                onClick={() => {
                  onClose();
                  onChangelog();
                }}
              >
                <SparklesIcon /> {t("settings.checkUpdates")}
              </button>
              <p className="mt-4 max-w-sm text-[12.5px] leading-relaxed text-mute">
                {t("settings.aboutText")}
              </p>
              <p className="mt-4 text-[11.5px] text-faint">Rust · Tauri · React</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

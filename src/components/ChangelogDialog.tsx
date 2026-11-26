import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, compareVersions, type ReleaseInfo } from "../lib/api";
import { formatBytes, notesFor } from "../lib/format";
import type { Updater } from "../lib/useUpdater";
import { Modal } from "./Modal";
import { locale, useLang, useT } from "../i18n";
import { AlertIcon, CheckCircleIcon, OpenIcon, RefreshIcon, SparklesIcon } from "./Icons";

interface Props {
  updater: Updater;
  onClose: () => void;
  onError: (msg: string) => void;
}

function formatDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Release notes as Markdown; links open in the system browser. */
export function Notes({ text }: { text: string }) {
  const t = useT();
  const lang = useLang();
  return (
    <div className="md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) api.openUrl(href).catch(() => {});
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {notesFor(text, lang) || t("changelog.noNotes")}
      </Markdown>
    </div>
  );
}

function UpdateBanner({ updater, onError }: { updater: Updater; onError: (m: string) => void }) {
  const { state, install, check, installNow, version } = updater;
  const t = useT();

  if (install) {
    const pct = install.phase === "downloading" && install.total ? Math.min(100, (install.downloaded / install.total) * 100) : null;
    return (
      <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />
          {install.phase === "downloading" ? t("changelog.downloading") : t("changelog.installing")}
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-track">
          <div
            className="progress-stripes h-full rounded-full bg-gradient-to-r from-brand to-brand-2 transition-[width] duration-200"
            style={{ width: install.phase === "installing" ? "100%" : pct != null ? `${pct}%` : "8%" }}
          />
        </div>
        {install.phase === "downloading" && (
          <p className="mt-2 text-[11.5px] tabular-nums text-mute">
            {formatBytes(install.downloaded)}
            {install.total ? ` / ${formatBytes(install.total)}` : ""}
          </p>
        )}
      </div>
    );
  }

  switch (state.kind) {
    case "available":
      return (
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-brand to-brand-2 p-4 text-white shadow-lg shadow-brand/25">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20">
              <SparklesIcon className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold">{t("changelog.available", { version: state.update.version })}</div>
              <div className="text-[12px] text-white/85">
                {t("changelog.availableBody", { version })}
              </div>
            </div>
            <button
              className="btn shrink-0 bg-white text-brand shadow-md hover:bg-white/90"
              onClick={() => installNow().catch((e) => onError(String(e)))}
            >
              <RefreshIcon /> {t("changelog.installNow")}
            </button>
          </div>
        </div>
      );
    case "latest":
      return (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-panel/60 p-4">
          <CheckCircleIcon className="h-6 w-6 shrink-0 text-emerald-500" />
          <div className="flex-1">
            <div className="text-[13.5px] font-medium text-ink">{t("changelog.latest")}</div>
            <div className="text-[12px] text-mute">{t("changelog.checkedAt", { version, time: new Date(state.checkedAt).toLocaleTimeString(locale()) })}</div>
          </div>
          <button className="btn-outline" onClick={() => check()}>
            <RefreshIcon /> {t("changelog.checkAgain")}
          </button>
        </div>
      );
    case "error":
      return (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
          <AlertIcon className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium text-ink">{t("changelog.checkFailed")}</div>
            <div className="text-[12px] break-words text-mute">{state.message}</div>
          </div>
          <button className="btn-outline" onClick={() => check()}>
            <RefreshIcon /> {t("common.retry")}
          </button>
        </div>
      );
    default:
      return (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-panel/60 p-4 text-[13px] text-mute">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand/25 border-t-brand" /> {t("changelog.checking")}
        </div>
      );
  }
}

function Badges({ r, current }: { r: ReleaseInfo; current: string }) {
  const t = useT();
  const cmp = current ? compareVersions(r.version, current) : -1;
  return (
    <>
      {cmp === 0 && <span className="rounded-full bg-emerald-500/12 px-2 py-px text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">{t("changelog.badgeCurrent")}</span>}
      {cmp > 0 && <span className="rounded-full bg-brand/12 px-2 py-px text-[10.5px] font-medium text-brand">{t("changelog.badgeNew")}</span>}
      {r.prerelease && <span className="rounded-full bg-amber-500/14 px-2 py-px text-[10.5px] font-medium text-amber-700 dark:text-amber-300">{t("changelog.badgePrerelease")}</span>}
    </>
  );
}

export function ChangelogDialog({ updater, onClose, onError }: Props) {
  const [releases, setReleases] = useState<ReleaseInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const current = updater.version;
  const t = useT();

  useEffect(() => {
    if (updater.state.kind === "idle" || updater.state.kind === "error") updater.check();
    api
      .listReleases()
      .then((r) => {
        setReleases(r);
        // Open the newest release that is newer than ours, else the newest one.
        const newer = r.filter((x) => compareVersions(x.version, updater.version || "0") > 0);
        setSelected((newer[0] ?? r[0])?.version ?? null);
      })
      .catch((e) => setLoadError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const release = releases?.find((r) => r.version === selected) ?? null;

  return (
    <Modal
      title={t("changelog.title")}
      subtitle={current ? t("changelog.currentVersion", { version: current }) : undefined}
      icon={<SparklesIcon />}
      onClose={updater.install ? () => {} : onClose}
      width="max-w-[940px]"
      flush
    >
      <div className="px-6 pb-4">
        <UpdateBanner updater={updater} onError={onError} />
      </div>

      <div className="grid h-[min(520px,calc(100vh-260px))] min-h-[260px] grid-cols-[240px_minmax(0,1fr)] border-t border-line">
        {/* Version list */}
        <nav className="min-h-0 overflow-y-auto border-r border-line bg-panel/50 p-3">
          <p className="px-2 pb-2 text-[11px] font-semibold tracking-wider text-faint uppercase">{t("changelog.versions")}</p>
          {!releases && !loadError && <p className="px-2 text-[12.5px] text-mute">{t("changelog.loading")}</p>}
          {releases?.length === 0 && <p className="px-2 text-[12.5px] text-mute">{t("changelog.noReleases")}</p>}
          <div className="space-y-0.5">
            {releases?.map((r) => {
              const active = r.version === selected;
              return (
                <button
                  key={r.version}
                  onClick={() => setSelected(r.version)}
                  className={`relative w-full rounded-lg px-3 py-2.5 text-left transition ${
                    active ? "bg-card shadow-card ring-1 ring-line" : "hover:bg-ink/[0.045]"
                  }`}
                >
                  {active && <span className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand" />}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-[13.5px] font-semibold ${active ? "text-ink" : "text-ink-2"}`}>v{r.version}</span>
                    <Badges r={r} current={current} />
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-mute">{formatDay(r.publishedAt) || "—"}</div>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Selected version notes */}
        <section className="min-h-0 overflow-y-auto px-7 py-5">
          {loadError && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] text-red-600">{loadError}</p>}
          {!release && !loadError && (
            <div className="flex h-full items-center justify-center text-[13px] text-mute">
              {releases ? t("changelog.pickVersion") : t("changelog.loadingNotes")}
            </div>
          )}
          {release && (
            <article key={release.version} className="animate-fade-in">
              <header className="mb-4 flex items-start gap-4 border-b border-line pb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[20px] font-semibold tracking-tight text-ink">v{release.version}</h3>
                    <Badges r={release} current={current} />
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-mute">
                    {release.name !== `v${release.version}` && <>{release.name} · </>}
                    {formatDay(release.publishedAt) ? t("changelog.released", { date: formatDay(release.publishedAt) }) : ""}
                  </p>
                </div>
                <button className="btn-outline shrink-0" onClick={() => api.openUrl(release.url)}>
                  <OpenIcon /> {t("changelog.viewOnGithub")}
                </button>
              </header>
              <Notes text={release.notes} />
            </article>
          )}
        </section>
      </div>
    </Modal>
  );
}

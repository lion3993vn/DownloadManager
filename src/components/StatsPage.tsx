import { useMemo, useState, type ReactNode } from "react";
import type { Row } from "../lib/useDownloads";
import { fileKind, hostOf, KIND_COLORS, type FileKind } from "../lib/format";
import { AreaChart, BarList, ColumnChart, type BarItem, type Column } from "./charts";
import { TYPE_FILTERS } from "./Sidebar";
import { FileIcon, GlobeIcon } from "./Icons";
import { locale, useLang, useT } from "../i18n";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
const DAY = 86_400_000;

/** 1536 -> "1.5 KB": up to two decimals, trailing zeros dropped (axis-friendly). */
export function compactBytes(v: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${Number(v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2))} ${units[i]}`;
}

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayKey(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const sizeOf = (r: Row) => r.totalSize ?? r.downloaded;

function Card({ title, subtitle, action, children, className = "" }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 p-4 ${className}`}>
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-[11.5px] text-mute">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card min-w-0 px-4 py-3.5">
      <div className="truncate text-[11.5px] text-mute">{label}</div>
      <div className="mt-1 truncate text-[20px] leading-tight font-semibold tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11.5px] text-mute">{sub}</div>}
    </div>
  );
}

export function StatsPage({ rows, speedHistory }: { rows: Row[]; speedHistory: number[] }) {
  const [range, setRange] = useState<Range>(30);
  const [asTable, setAsTable] = useState(false);
  const t = useT();
  const lang = useLang();

  const s = useMemo(() => {
    const weekdays = t("stats.weekdays").split(",");
    const today = startOfDay(Date.now());
    const from = today - (range - 1) * DAY;
    const done = rows.filter((r) => r.status === "completed" && (r.completedAt ?? 0) >= from);
    // Failures have no timestamp of their own; the time they were added is close enough.
    const failed = rows.filter((r) => r.status === "failed" && r.createdAt >= from).length;
    const bytes = done.reduce((sum, r) => sum + sizeOf(r), 0);

    const perDay = new Map<string, { bytes: number; files: number }>();
    for (const r of done) {
      const k = dayKey(r.completedAt!);
      const e = perDay.get(k) ?? { bytes: 0, files: 0 };
      e.bytes += sizeOf(r);
      e.files += 1;
      perDay.set(k, e);
    }
    const days: Column[] = [];
    for (let i = 0; i < range; i++) {
      const ms = from + i * DAY;
      const d = new Date(ms);
      const e = perDay.get(dayKey(ms));
      // "26/11" in Vietnamese, "11/26" in English.
      const date = d.toLocaleDateString(locale(lang), { day: "numeric", month: "numeric" });
      const full = d.toLocaleDateString(locale(lang), { day: "numeric", month: "numeric", year: "numeric" });
      days.push({
        key: dayKey(ms),
        label: range === 7 ? `${weekdays[d.getDay()]} ${date}` : date,
        title: `${weekdays[d.getDay()]}, ${full}`,
        value: e?.bytes ?? 0,
        detail: e ? t("stats.files", { n: e.files }) : t("stats.noFiles"),
      });
    }

    const byKind = new Map<FileKind, { bytes: number; files: number }>();
    const byHost = new Map<string, { bytes: number; files: number }>();
    for (const r of done) {
      const k = fileKind(r.fileName);
      const ek = byKind.get(k) ?? { bytes: 0, files: 0 };
      ek.bytes += sizeOf(r);
      ek.files += 1;
      byKind.set(k, ek);
      const h = hostOf(r.url) || t("stats.otherHost");
      const eh = byHost.get(h) ?? { bytes: 0, files: 0 };
      eh.bytes += sizeOf(r);
      eh.files += 1;
      byHost.set(h, eh);
    }
    const kindLabel = (k: FileKind) => t(TYPE_FILTERS.find((f) => f.key === k)?.label ?? "stats.kind.other");
    const kindIcon = (k: FileKind) => {
      const Icon = TYPE_FILTERS.find((f) => f.key === k)?.icon ?? FileIcon;
      return (
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${KIND_COLORS[k]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      );
    };
    const kinds: BarItem[] = [...byKind.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([k, e]) => ({ key: k, label: kindLabel(k), icon: kindIcon(k), value: e.bytes, detail: t("stats.files", { n: e.files }) }));
    const hosts: BarItem[] = [...byHost.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, 6)
      .map(([h, e]) => ({
        key: h,
        label: h,
        icon: <GlobeIcon className="h-3.5 w-3.5 shrink-0 text-faint" />,
        value: e.bytes,
        detail: t("stats.files", { n: e.files }),
      }));

    const largest = done.reduce<Row | null>((a, r) => (!a || sizeOf(r) > sizeOf(a) ? r : a), null);
    const activeDays = perDay.size;
    return {
      bytes,
      files: done.length,
      failed,
      successRate: done.length + failed ? done.length / (done.length + failed) : null,
      largest,
      perActiveDay: activeDays ? bytes / activeDays : 0,
      activeDays,
      days,
      kinds,
      hosts,
    };
  }, [rows, range, t, lang]);

  const peak = Math.max(0, ...speedHistory);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="px-5 pt-5 pb-3">
        <h1 className="text-[20px] font-semibold tracking-tight">{t("stats.title")}</h1>
        <p className="text-[12px] text-mute">{t("stats.subtitle")}</p>
      </header>

      {/* One filter row, scoping everything below (except the live speed card). */}
      <div className="px-5 pb-4">
        <div className="inline-flex gap-1 rounded-lg bg-panel p-1" role="group" aria-label={t("stats.rangeLabel")}>
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition ${range === r ? "bg-card text-brand shadow-card" : "text-mute hover:text-ink"}`}
            >
              {t("stats.days", { n: r })}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-5 pb-6">
        <div className="grid grid-cols-2 gap-3 @[900px]:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* The page's one hero figure. */}
          <div className="card col-span-2 min-w-0 px-5 py-4 @[900px]:col-span-1">
            <div className="text-[11.5px] text-mute">{t("stats.downloadedIn", { n: range })}</div>
            <div className="mt-1 text-[48px] leading-none font-semibold tracking-tight text-ink">{compactBytes(s.bytes)}</div>
            <div className="mt-2 text-[12px] text-mute">
              {t("stats.completedFiles", { n: s.files })}
              {s.activeDays ? t("stats.activeDays", { n: s.activeDays }) : ""}
            </div>
          </div>
          <Tile
            label={t("stats.successRate")}
            value={s.successRate == null ? "—" : `${Math.round(s.successRate * 100)}%`}
            sub={s.failed ? t("stats.failedCount", { n: s.failed }) : s.successRate == null ? t("stats.noData") : t("stats.noFailures")}
          />
          <Tile label={t("stats.largest")} value={s.largest ? compactBytes(sizeOf(s.largest)) : "—"} sub={s.largest?.fileName} />
          <Tile label={t("stats.perActiveDay")} value={s.activeDays ? compactBytes(s.perActiveDay) : "—"} sub={s.activeDays ? t("stats.days", { n: s.activeDays }) : undefined} />
        </div>

        <Card
          title={t("stats.perDay")}
          subtitle={t("stats.perDaySub", { n: range })}
          action={
            <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
              {asTable ? t("stats.showChart") : t("stats.showTable")}
            </button>
          }
        >
          {s.files === 0 ? (
            <p className="py-14 text-center text-[12.5px] text-mute">{t("stats.noneCompleted", { n: range })}</p>
          ) : asTable ? (
            <div className="max-h-[240px] overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-card text-left text-[11.5px] text-mute">
                  <tr>
                    <th className="py-1.5 font-medium">{t("stats.colDate")}</th>
                    <th className="py-1.5 text-right font-medium">{t("stats.colSize")}</th>
                    <th className="py-1.5 text-right font-medium">{t("stats.colFiles")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-ink-2">
                  {[...s.days]
                    .reverse()
                    .filter((d) => d.value > 0)
                    .map((d) => (
                      <tr key={d.key}>
                        <td className="py-1.5">{d.title}</td>
                        <td className="py-1.5 text-right tabular-nums">{compactBytes(d.value)}</td>
                        <td className="py-1.5 text-right tabular-nums">{d.detail}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <ColumnChart data={s.days} format={compactBytes} height={210} />
          )}
        </Card>

        <div className="grid grid-cols-1 gap-3 @[760px]:grid-cols-2">
          <Card title={t("stats.byKind")} subtitle={t("stats.byKindSub")}>
            <BarList items={s.kinds} format={compactBytes} empty={t("stats.noDataDot")} />
          </Card>
          <Card title={t("stats.topHosts")} subtitle={t("stats.topHostsSub")}>
            <BarList items={s.hosts} format={compactBytes} empty={t("stats.noDataDot")} />
          </Card>
        </div>

        <Card title={t("stats.speed")} subtitle={t("stats.speedSub") + (peak > 0 ? t("stats.speedPeak", { speed: compactBytes(peak) }) : "")}>
          <AreaChart
            values={speedHistory}
            idle={t("stats.idle")}
            format={compactBytes}
            pointLabel={(i) => {
              const ago = speedHistory.length - 1 - i;
              return ago === 0 ? t("stats.now") : t("stats.secondsAgo", { n: ago });
            }}
          />
        </Card>
      </div>
    </div>
  );
}

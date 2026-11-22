import { useMemo, useState, type ReactNode } from "react";
import type { Row } from "../lib/useDownloads";
import { fileKind, hostOf, KIND_COLORS, type FileKind } from "../lib/format";
import { AreaChart, BarList, ColumnChart, type BarItem, type Column } from "./charts";
import { TYPE_FILTERS } from "./Sidebar";
import { FileIcon, GlobeIcon } from "./Icons";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
const DAY = 86_400_000;
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

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

  const s = useMemo(() => {
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
      const t = from + i * DAY;
      const d = new Date(t);
      const e = perDay.get(dayKey(t));
      const date = `${d.getDate()}/${d.getMonth() + 1}`;
      days.push({
        key: dayKey(t),
        label: range === 7 ? `${WEEKDAYS[d.getDay()]} ${date}` : date,
        title: `${WEEKDAYS[d.getDay()]}, ${date}/${d.getFullYear()}`,
        value: e?.bytes ?? 0,
        detail: e ? `${e.files} tệp` : "không có tệp",
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
      const h = hostOf(r.url) || "khác";
      const eh = byHost.get(h) ?? { bytes: 0, files: 0 };
      eh.bytes += sizeOf(r);
      eh.files += 1;
      byHost.set(h, eh);
    }
    const kindLabel = (k: FileKind) => TYPE_FILTERS.find((t) => t.key === k)?.label ?? "Khác";
    const kindIcon = (k: FileKind) => {
      const Icon = TYPE_FILTERS.find((t) => t.key === k)?.icon ?? FileIcon;
      return (
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${KIND_COLORS[k]}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
      );
    };
    const kinds: BarItem[] = [...byKind.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .map(([k, e]) => ({ key: k, label: kindLabel(k), icon: kindIcon(k), value: e.bytes, detail: `${e.files} tệp` }));
    const hosts: BarItem[] = [...byHost.entries()]
      .sort((a, b) => b[1].bytes - a[1].bytes)
      .slice(0, 6)
      .map(([h, e]) => ({
        key: h,
        label: h,
        icon: <GlobeIcon className="h-3.5 w-3.5 shrink-0 text-faint" />,
        value: e.bytes,
        detail: `${e.files} tệp`,
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
  }, [rows, range]);

  const peak = Math.max(0, ...speedHistory);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="px-5 pt-5 pb-3">
        <h1 className="text-[20px] font-semibold tracking-tight">Thống kê</h1>
        <p className="text-[12px] text-mute">Tính từ các lượt tải đang có trong danh sách. Lượt tải đã xóa không được tính.</p>
      </header>

      {/* One filter row, scoping everything below (except the live speed card). */}
      <div className="px-5 pb-4">
        <div className="inline-flex gap-1 rounded-lg bg-panel p-1" role="group" aria-label="Khoảng thời gian">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition ${range === r ? "bg-card text-brand shadow-card" : "text-mute hover:text-ink"}`}
            >
              {r} ngày
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-5 pb-6">
        <div className="grid grid-cols-2 gap-3 @[900px]:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* The page's one hero figure. */}
          <div className="card col-span-2 min-w-0 px-5 py-4 @[900px]:col-span-1">
            <div className="text-[11.5px] text-mute">Đã tải về trong {range} ngày</div>
            <div className="mt-1 text-[48px] leading-none font-semibold tracking-tight text-ink">{compactBytes(s.bytes)}</div>
            <div className="mt-2 text-[12px] text-mute">
              {s.files} tệp hoàn tất{s.activeDays ? ` trong ${s.activeDays} ngày có tải` : ""}
            </div>
          </div>
          <Tile
            label="Tỉ lệ thành công"
            value={s.successRate == null ? "—" : `${Math.round(s.successRate * 100)}%`}
            sub={s.failed ? `${s.failed} lượt lỗi` : s.successRate == null ? "Chưa có dữ liệu" : "Không có lượt lỗi"}
          />
          <Tile label="Tệp lớn nhất" value={s.largest ? compactBytes(sizeOf(s.largest)) : "—"} sub={s.largest?.fileName} />
          <Tile label="Trung bình mỗi ngày có tải" value={s.activeDays ? compactBytes(s.perActiveDay) : "—"} sub={s.activeDays ? `${s.activeDays} ngày` : undefined} />
        </div>

        <Card
          title="Dung lượng tải theo ngày"
          subtitle={`${range} ngày gần nhất, theo ngày hoàn tất`}
          action={
            <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
              {asTable ? "Xem biểu đồ" : "Xem dạng bảng"}
            </button>
          }
        >
          {s.files === 0 ? (
            <p className="py-14 text-center text-[12.5px] text-mute">Chưa có lượt tải nào hoàn tất trong {range} ngày qua.</p>
          ) : asTable ? (
            <div className="max-h-[240px] overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-card text-left text-[11.5px] text-mute">
                  <tr>
                    <th className="py-1.5 font-medium">Ngày</th>
                    <th className="py-1.5 text-right font-medium">Dung lượng</th>
                    <th className="py-1.5 text-right font-medium">Số tệp</th>
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
          <Card title="Theo loại tệp" subtitle="Dung lượng đã tải">
            <BarList items={s.kinds} format={compactBytes} empty="Chưa có dữ liệu." />
          </Card>
          <Card title="Trang tải nhiều nhất" subtitle="Theo dung lượng, tối đa 6 trang">
            <BarList items={s.hosts} format={compactBytes} empty="Chưa có dữ liệu." />
          </Card>
        </div>

        <Card title="Tốc độ tải" subtitle={`Trực tiếp · 60 giây qua${peak > 0 ? ` · cao nhất ${compactBytes(peak)}/s` : ""}`}>
          <AreaChart
            values={speedHistory}
            idle="Không có lượt tải nào đang chạy"
            format={compactBytes}
            pointLabel={(i) => {
              const ago = speedHistory.length - 1 - i;
              return ago === 0 ? "Bây giờ" : `${ago} giây trước`;
            }}
          />
        </Card>
      </div>
    </div>
  );
}

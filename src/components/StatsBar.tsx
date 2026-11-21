import { formatBytes, formatSpeed } from "../lib/format";
import { BoltIcon, CheckCircleIcon, DiskIcon, DownloadIcon } from "./Icons";
import { Sparkline } from "./Sparkline";

interface Props {
  speed: number;
  history: number[];
  active: number;
  queued: number;
  completed: number;
  totalBytes: number;
}

function Stat({ icon, label, value, sub, tone, className = "" }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone: string; className?: string }) {
  return (
    <div className={`card ${className || "flex"} min-w-0 items-center gap-3 px-4 py-3`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</div>
      <div className="min-w-0">
        <div className="truncate text-[11.5px] whitespace-nowrap text-mute">{label}</div>
        <div className="truncate text-[16px] leading-tight font-semibold tabular-nums text-ink">
          {value}
          {sub && <span className="ml-1 text-[11.5px] font-normal text-mute">{sub}</span>}
        </div>
      </div>
    </div>
  );
}

export function StatsBar({ speed, history, active, queued, completed, totalBytes }: Props) {
  return (
    <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-3 px-5 pt-1 pb-4 @[760px]:grid-cols-[1.6fr_1fr_1fr_1fr]">
      <div className="card relative overflow-hidden px-4 py-3">
        <Sparkline values={history} className="absolute inset-x-0 bottom-0 h-9 w-full opacity-60" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <BoltIcon className="h-[18px] w-[18px]" />
          </div>
          <div>
            <div className="text-[11.5px] text-mute">Tốc độ hiện tại</div>
            <div className="text-[20px] leading-tight font-semibold tracking-tight tabular-nums text-ink">{formatSpeed(speed)}</div>
          </div>
        </div>
      </div>
      <Stat
        icon={<DownloadIcon className="h-[18px] w-[18px]" />}
        label="Đang tải"
        value={String(active)}
        sub={queued ? `+${queued} chờ` : undefined}
        tone="bg-sky-500/12 text-sky-600 dark:text-sky-400"
      />
      <Stat
        icon={<CheckCircleIcon className="h-[18px] w-[18px]" />}
        label="Hoàn tất"
        value={String(completed)}
        tone="bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
      />
      <Stat
        icon={<DiskIcon className="h-[18px] w-[18px]" />}
        label="Đã tải về"
        value={formatBytes(totalBytes)}
        tone="bg-violet-500/12 text-violet-600 dark:text-violet-400"
        className="hidden @[760px]:flex"
      />
    </div>
  );
}

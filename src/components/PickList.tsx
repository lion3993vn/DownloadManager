// A checklist of downloads to add at once: pasted links (batch) or the videos
// of a playlist. Everything starts checked; `unchecked` holds the exceptions.
import type { ReactNode } from "react";
import { FileTile } from "./FileTile";
import { useT } from "../i18n";

export interface PickItem {
  key: string;
  title: string;
  sub?: string;
  /** Video thumbnail; otherwise a file-type tile from `title`. */
  thumb?: string | null;
}

interface Props {
  items: PickItem[];
  unchecked: Set<string>;
  onChange: (unchecked: Set<string>) => void;
  /** Shown at the right of the header row. */
  extra?: ReactNode;
}

export function PickList({ items, unchecked, onChange, extra }: Props) {
  const t = useT();
  const picked = items.length - items.filter((i) => unchecked.has(i.key)).length;
  const all = picked === items.length;

  function toggle(key: string) {
    const next = new Set(unchecked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  return (
    <div className="animate-fade-in overflow-hidden rounded-xl border border-line">
      <div className="flex items-center gap-3 border-b border-line bg-panel/60 px-3 py-2 text-[12px]">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-brand)]"
          checked={all}
          ref={(el) => {
            if (el) el.indeterminate = picked > 0 && !all;
          }}
          onChange={() => onChange(all ? new Set(items.map((i) => i.key)) : new Set())}
          aria-label={t("add.selectAll")}
        />
        <span className="font-medium text-ink-2">{t("add.selected", { n: picked, total: items.length })}</span>
        <span className="flex-1" />
        {extra}
      </div>
      <ul className="max-h-[248px] overflow-y-auto">
        {items.map((item) => (
          <li key={item.key}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-ink/[0.03]">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[var(--color-brand)]"
                checked={!unchecked.has(item.key)}
                onChange={() => toggle(item.key)}
              />
              {item.thumb ? (
                <img src={item.thumb} alt="" className="h-9 w-16 shrink-0 rounded-md bg-track object-cover" referrerPolicy="no-referrer" loading="lazy" />
              ) : (
                <FileTile name={item.title} />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink" title={item.title}>
                  {item.title}
                </span>
                {item.sub && <span className="block truncate text-[11.5px] text-mute">{item.sub}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

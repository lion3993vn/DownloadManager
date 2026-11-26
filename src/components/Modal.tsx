import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "./Icons";
import { useT } from "../i18n";

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  /** Remove body padding (for layouts that manage their own). */
  flush?: boolean;
  /** Destructive dialog: red icon tile. */
  danger?: boolean;
}

export function Modal({ title, subtitle, icon, onClose, children, footer, width = "max-w-lg", flush, danger }: Props) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`animate-fade-up flex max-h-full w-full ${width} flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl shadow-black/20`}
      >
        <div className="flex items-start gap-3 px-6 pt-5 pb-4">
          {icon && (
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${danger ? "bg-red-500/10 text-red-600" : "bg-brand/10 text-brand"}`}>
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] leading-6 font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12.5px] text-mute">{subtitle}</p>}
          </div>
          <button className="icon-btn -mt-1 -mr-2" onClick={onClose} aria-label={t("common.close")}>
            <CloseIcon />
          </button>
        </div>
        <div className={`min-h-0 overflow-y-auto ${flush ? "" : "px-6 pb-5"}`}>{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-panel/60 px-6 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11.5px] leading-relaxed text-mute">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-brand" : "bg-line-strong"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[21px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

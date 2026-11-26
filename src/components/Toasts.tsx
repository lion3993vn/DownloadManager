import { useCallback, useState } from "react";
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon } from "./Icons";
import { useT } from "../i18n";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

let nextId = 1;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId++;
      setToasts((old) => [...old.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === "error" || t.action ? 9000 : 5000);
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

const STYLE = {
  success: { icon: CheckCircleIcon, color: "text-emerald-500" },
  error: { icon: AlertIcon, color: "text-red-500" },
  info: { icon: InfoIcon, color: "text-brand" },
};

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  const tr = useT();
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[80] flex w-[340px] flex-col gap-2">
      {toasts.map((t) => {
        const { icon: Icon, color } = STYLE[t.kind];
        return (
          <div key={t.id} className="animate-fade-up pointer-events-auto flex gap-3 rounded-xl border border-line bg-card p-3.5 shadow-2xl shadow-black/15">
            <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${color}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{t.title}</p>
              {t.body && <p className="mt-0.5 line-clamp-2 text-[12px] break-words text-mute">{t.body}</p>}
              {t.action && (
                <button
                  className="mt-2 text-[12px] font-medium text-brand hover:underline"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button className="icon-btn -mt-1 -mr-1 h-6 w-6" onClick={() => dismiss(t.id)} aria-label={tr("common.close")}>
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

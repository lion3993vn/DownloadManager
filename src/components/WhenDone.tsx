// "When done": sleep / shut down / quit once every download has finished.
// The choice lives in the app (finish.rs), in memory only; this is its menu
// button and the countdown shown before it runs.
import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import {
  api,
  onWhenDone,
  onWhenDoneCanceled,
  onWhenDoneChanged,
  onWhenDoneFailed,
  type WhenDone,
} from "../lib/api";
import { useT, type MessageKey } from "../i18n";
import { Modal } from "./Modal";
import { CheckIcon, FlagIcon, LogOutIcon, MoonIcon, PowerIcon } from "./Icons";

type IconT = ComponentType<SVGProps<SVGSVGElement>>;

const OPTIONS: { value: WhenDone; label: MessageKey; icon: IconT }[] = [
  { value: "nothing", label: "finish.nothing", icon: FlagIcon },
  { value: "sleep", label: "finish.sleep", icon: MoonIcon },
  { value: "shutdown", label: "finish.shutdown", icon: PowerIcon },
  { value: "quit", label: "finish.quit", icon: LogOutIcon },
];

const COUNTDOWN_TITLE: Record<Exclude<WhenDone, "nothing">, MessageKey> = {
  sleep: "finish.countdownSleep",
  shutdown: "finish.countdownShutdown",
  quit: "finish.countdownQuit",
};

/** Toolbar button: pick what happens when the queue is done. */
export function WhenDoneMenu({ onError }: { onError: (msg: string) => void }) {
  const t = useT();
  const [action, setAction] = useState<WhenDone>("nothing");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getWhenDone().then(setAction).catch(() => {});
    const sub = onWhenDoneChanged(setAction);
    return () => {
      sub.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.value === action) ?? OPTIONS[0];
  const armed = action !== "nothing";
  const Icon = current.icon;

  function pick(value: WhenDone) {
    setOpen(false);
    api
      .setWhenDone(value)
      .then(() => setAction(value))
      .catch((e) => onError(String(e)));
  }

  return (
    <div ref={ref} className="relative">
      <button
        className={`btn-outline ${armed ? "!border-amber-500/50 !bg-amber-500/10 !text-amber-700 dark:!text-amber-300" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={armed ? `${t("finish.button")}: ${t(current.label)}` : t("finish.button")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon />
        <span className="hidden @[700px]:inline">{armed ? t(current.label) : t("finish.button")}</span>
      </button>
      {open && (
        <div role="menu" className="animate-fade-in absolute top-full right-0 z-40 mt-1.5 w-64 rounded-xl border border-line bg-card p-1.5 shadow-xl shadow-black/10">
          <div className="px-2.5 pt-1 pb-1.5 text-[11.5px] font-semibold text-mute">{t("finish.menuTitle")}</div>
          {OPTIONS.map(({ value, label, icon: ItemIcon }) => (
            <button
              key={value}
              role="menuitemradio"
              aria-checked={value === action}
              onClick={() => pick(value)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-ink/[0.05]"
            >
              <ItemIcon className="h-4 w-4 text-mute" />
              <span className="flex-1">{t(label)}</span>
              {value === action && <CheckIcon className="h-4 w-4 text-brand" />}
            </button>
          ))}
          <p className="px-2.5 pt-1.5 pb-1 text-[11.5px] leading-snug text-mute">{t("finish.menuHint")}</p>
        </div>
      )}
    </div>
  );
}

/** The countdown before the action runs; closing it cancels the action. */
export function WhenDoneCountdown({ onError }: { onError: (msg: string) => void }) {
  const t = useT();
  const [state, setState] = useState<{ action: WhenDone; until: number; total: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const subs = [
      onWhenDone((c) => setState({ action: c.action, until: Date.now() + c.seconds * 1000, total: c.seconds })),
      onWhenDoneCanceled(() => setState(null)),
      // Reset to "nothing": canceled, or the action is running now.
      onWhenDoneChanged((a) => a === "nothing" && setState(null)),
      onWhenDoneFailed((error) => onError(t("finish.failed", { error }))),
    ];
    return () => subs.forEach((u) => u.then((f) => f()));
  }, [onError, t]);

  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state]);

  if (!state || state.action === "nothing") return null;
  const left = Math.max(0, Math.ceil((state.until - now) / 1000));
  const pct = Math.min(100, Math.max(0, ((state.total - (state.until - now) / 1000) / state.total) * 100));
  const option = OPTIONS.find((o) => o.value === state.action) ?? OPTIONS[0];
  const Icon = option.icon;
  const cancel = () => {
    setState(null);
    api.cancelWhenDone().catch((e) => onError(String(e)));
  };

  return (
    <Modal
      title={t(COUNTDOWN_TITLE[state.action])}
      subtitle={t("finish.countdownSubtitle")}
      icon={<Icon />}
      onClose={cancel}
      footer={
        <>
          <button className="btn-ghost" onClick={() => api.whenDoneNow().catch((e) => onError(String(e)))}>
            {t("finish.now")}
          </button>
          <button className="btn-primary min-w-[110px]" onClick={cancel} autoFocus>
            {t("common.cancel")}
          </button>
        </>
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[40px] leading-none font-semibold tabular-nums">{left}</span>
        <span className="text-[13px] text-mute">{t("finish.seconds")}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full bg-amber-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
    </Modal>
  );
}

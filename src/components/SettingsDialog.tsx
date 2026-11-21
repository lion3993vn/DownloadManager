import { useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type BridgeStatus, type Settings } from "../lib/api";
import type { ThemePref } from "../lib/theme";
import { Field, Modal, Switch } from "./Modal";
import {
  CopyIcon,
  DownloadIcon,
  FolderIcon,
  InfoIcon,
  MonitorIcon,
  MoonIcon,
  PuzzleIcon,
  RefreshIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
} from "./Icons";

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

type Tab = "download" | "browser" | "app" | "about";
type IconT = ComponentType<SVGProps<SVGSVGElement>>;

const TABS: { key: Tab; label: string; icon: IconT }[] = [
  { key: "download", label: "Tải xuống", icon: DownloadIcon },
  { key: "browser", label: "Trình duyệt", icon: PuzzleIcon },
  { key: "app", label: "Giao diện", icon: SettingsIcon },
  { key: "about", label: "Giới thiệu", icon: InfoIcon },
];

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
  const [tab, setTab] = useState<Tab>("download");
  const [s, setS] = useState<Settings | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const [limitOn, setLimitOn] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then((v) => {
        setS(v);
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
      onSaved(await api.saveSettings(toSave));
      onClose();
    } catch (e) {
      onError(String(e));
    }
  }

  return (
    <Modal
      title="Cài đặt"
      icon={<SettingsIcon />}
      onClose={onClose}
      width="max-w-[720px]"
      flush
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-primary min-w-[96px]" onClick={save}>
            Lưu
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
              <Icon className={`h-4 w-4 ${tab === key ? "text-brand" : "text-mute"}`} /> {label}
            </button>
          ))}
        </nav>

        <div className="px-6 py-4">
          {tab === "download" && (
            <>
              <Field label="Thư mục lưu mặc định">
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
                    Chọn…
                  </button>
                </div>
              </Field>
              <div className="mt-3">
                <Row title="Kết nối cho mỗi tệp" hint="Số đoạn tải song song (1–32).">
                  <Stepper value={eng.connections} min={1} max={32} onChange={(v) => setEngine({ connections: v })} />
                </Row>
                <Row title="Số tệp tải cùng lúc" hint="Các tệp còn lại sẽ xếp hàng chờ.">
                  <Stepper value={eng.maxConcurrent} min={1} max={20} onChange={(v) => setEngine({ maxConcurrent: v })} />
                </Row>
                <Row title="Giới hạn tốc độ" hint="Áp dụng cho tổng tất cả lượt tải.">
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

          {tab === "browser" && (
            <>
              <div className="flex items-center gap-3 rounded-xl border border-line bg-panel/60 p-4">
                <span className={`h-2.5 w-2.5 rounded-full ${bridge?.running ? "bg-emerald-500" : "bg-red-500"}`} />
                <div className="flex-1">
                  <div className="text-[13px] font-medium">{bridge?.running ? "Đang lắng nghe extension" : "Cầu nối không chạy"}</div>
                  <div className="text-[12px] text-mute">
                    {bridge?.running ? `127.0.0.1:${bridge.port} — chỉ nhận kết nối từ máy này` : (bridge?.error ?? "")}
                  </div>
                </div>
                <button
                  className="btn-primary"
                  onClick={() => {
                    onClose();
                    onInstallExtension();
                  }}
                >
                  <PuzzleIcon /> Cài extension
                </button>
              </div>
              <div className="mt-2">
                <Row title="Hỏi trước khi tải" hint="Hiện hộp xác nhận khi bắt được tệp từ trình duyệt.">
                  <Switch checked={s.app.confirmCaptures} onChange={(v) => setApp({ confirmCaptures: v })} />
                </Row>
              </div>
              <Field
                label="Mã ghép cặp"
                hint="Extension cài từ app tự dùng mã này. Tạo mã mới sẽ ngắt kết nối các extension cũ cho tới khi chúng tự cập nhật."
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
                    <CopyIcon /> {copied ? "Đã chép" : "Chép"}
                  </button>
                  <button
                    className="btn-outline px-2.5"
                    title="Tạo mã mới"
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
              <Field label="Chủ đề">
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["system", "Theo hệ thống", MonitorIcon],
                      ["light", "Sáng", SunIcon],
                      ["dark", "Tối", MoonIcon],
                    ] as const
                  ).map(([key, label, Icon]) => (
                    <button
                      key={key}
                      onClick={() => onTheme(key)}
                      className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-[12.5px] transition ${
                        theme === key ? "border-brand bg-brand/5 font-medium text-brand ring-4 ring-brand/10" : "border-line text-ink-2 hover:border-line-strong"
                      }`}
                    >
                      <Icon className="h-5 w-5" /> {label}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="mt-3">
                <Row title="Chạy nền khi đóng cửa sổ" hint="Thu nhỏ xuống khay hệ thống để vẫn tải và bắt link từ trình duyệt.">
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
              <p className="text-[12px] text-mute">Phiên bản {version || "…"}</p>
              <button
                className="btn-primary mt-4"
                onClick={() => {
                  onClose();
                  onChangelog();
                }}
              >
                <SparklesIcon /> Kiểm tra cập nhật & xem có gì mới
              </button>
              <p className="mt-4 max-w-sm text-[12.5px] leading-relaxed text-mute">
                Tải tệp nhanh hơn bằng cách chia nhỏ và tải song song nhiều đoạn. Hỗ trợ tạm dừng, tiếp tục sau khi tắt máy, và tự
                bắt lượt tải từ trình duyệt.
              </p>
              <p className="mt-4 text-[11.5px] text-faint">Rust · Tauri · React</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

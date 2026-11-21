import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type BridgeStatus, type Settings } from "../lib/api";
import { Field, Modal } from "./Modal";
import { CopyIcon, FolderIcon, RefreshIcon } from "./Icons";

interface Props {
  onClose: () => void;
  onSaved: (s: Settings) => void;
  onError: (msg: string) => void;
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDialog({ onClose, onSaved, onError }: Props) {
  const [s, setS] = useState<Settings | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => onError(String(e)));
    api.bridgeStatus().then(setBridge);
  }, [onError]);

  if (!s) return null;
  const eng = s.engine;
  const setEngine = (patch: Partial<Settings["engine"]>) => setS({ ...s, engine: { ...eng, ...patch } });
  const setApp = (patch: Partial<Settings["app"]>) => setS({ ...s, app: { ...s.app, ...patch } });

  async function save() {
    try {
      const saved = await api.saveSettings(s!);
      onSaved(saved);
      onClose();
    } catch (e) {
      onError(String(e));
    }
  }

  async function copyToken() {
    await navigator.clipboard.writeText(s!.app.bridgeToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function regenerate() {
    const token = await api.regenerateToken();
    setApp({ bridgeToken: token });
  }

  return (
    <Modal
      title="Cài đặt"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-primary" onClick={save}>
            Lưu
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <Section title="Tải xuống">
          <Field label="Thư mục mặc định">
            <div className="flex gap-2">
              <input className="field" value={eng.downloadDir} onChange={(e) => setEngine({ downloadDir: e.target.value })} />
              <button
                className="btn-secondary shrink-0"
                onClick={async () => {
                  const dir = await open({ directory: true, defaultPath: eng.downloadDir });
                  if (typeof dir === "string") setEngine({ downloadDir: dir });
                }}
              >
                <FolderIcon /> Chọn…
              </button>
            </div>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Kết nối / tệp">
              <input
                type="number"
                min={1}
                max={32}
                className="field"
                value={eng.connections}
                onChange={(e) => setEngine({ connections: Number(e.target.value) })}
              />
            </Field>
            <Field label="Tải cùng lúc">
              <input
                type="number"
                min={1}
                max={20}
                className="field"
                value={eng.maxConcurrent}
                onChange={(e) => setEngine({ maxConcurrent: Number(e.target.value) })}
              />
            </Field>
            <Field label="Giới hạn (KB/s)" hint="0 = không giới hạn">
              <input
                type="number"
                min={0}
                className="field"
                value={Math.round(eng.speedLimit / 1024)}
                onChange={(e) => setEngine({ speedLimit: Math.max(0, Number(e.target.value)) * 1024 })}
              />
            </Field>
          </div>
        </Section>

        <Section title="Trình duyệt">
          <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
            {bridge?.running ? (
              <p className="text-emerald-600">● Đang lắng nghe extension tại 127.0.0.1:{bridge.port}</p>
            ) : (
              <p className="text-red-600">● Cầu nối extension không chạy{bridge?.error ? `: ${bridge.error}` : ""}</p>
            )}
            <p className="mt-2 text-slate-500">
              Cài extension trong thư mục <code>extension/</code> (Chrome/Edge: "Load unpacked"; Firefox:
              about:debugging). Bấm <b>Kết nối</b> trong extension để ghép cặp tự động, hoặc dán mã dưới đây vào
              phần tùy chọn của extension.
            </p>
          </div>
          <Field label="Mã ghép cặp">
            <div className="flex gap-2">
              <input readOnly className="field font-mono text-xs" value={s.app.bridgeToken} />
              <button className="btn-secondary shrink-0" onClick={copyToken}>
                <CopyIcon /> {copied ? "Đã chép" : "Chép"}
              </button>
              <button className="btn-secondary shrink-0" onClick={regenerate} title="Tạo mã mới (extension cũ phải ghép lại)">
                <RefreshIcon />
              </button>
            </div>
          </Field>
          <Toggle
            checked={s.app.confirmCaptures}
            onChange={(v) => setApp({ confirmCaptures: v })}
            label="Hỏi trước khi tải tệp bắt được từ trình duyệt"
            hint="Tắt để tải ngay vào thư mục mặc định."
          />
        </Section>

        <Section title="Ứng dụng">
          <Toggle
            checked={s.app.closeToTray}
            onChange={(v) => setApp({ closeToTray: v })}
            label="Đóng cửa sổ thì thu nhỏ xuống khay hệ thống"
            hint="App tiếp tục tải và nhận link từ trình duyệt khi chạy nền."
          />
        </Section>
      </div>
    </Modal>
  );
}

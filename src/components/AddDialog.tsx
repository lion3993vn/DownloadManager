import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Capture, type ProbeResult, type RequestHeaders } from "../lib/api";
import { formatBytes, isProbablyUrl } from "../lib/format";
import { Field, Modal } from "./Modal";
import { AlertIcon, CheckIcon, FolderIcon, PuzzleIcon } from "./Icons";

interface Props {
  /** Prefilled from a browser capture. */
  capture?: Capture;
  defaultDir: string;
  defaultConnections: number;
  onClose: () => void;
  onError: (msg: string) => void;
}

type ProbeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; result: ProbeResult }
  | { kind: "error"; message: string };

export function AddDialog({ capture, defaultDir, defaultConnections, onClose, onError }: Props) {
  const [url, setUrl] = useState(capture?.url ?? "");
  const [fileName, setFileName] = useState(capture?.fileName ?? "");
  const [nameTouched, setNameTouched] = useState(Boolean(capture?.fileName));
  const [saveDir, setSaveDir] = useState(defaultDir);
  const [connections, setConnections] = useState(defaultConnections);
  const [probe, setProbe] = useState<ProbeState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);

  const headers: RequestHeaders | undefined = capture
    ? { referrer: capture.referrer, userAgent: capture.userAgent, cookies: capture.cookies }
    : undefined;

  // Probe the URL (debounced) to show name, size and range support.
  useEffect(() => {
    const target = url.trim();
    if (!isProbablyUrl(target)) {
      setProbe({ kind: "idle" });
      return;
    }
    setProbe({ kind: "loading" });
    let stale = false;
    const t = setTimeout(() => {
      api
        .probe(target, headers)
        .then((result) => {
          if (stale) return;
          setProbe({ kind: "ok", result });
          if (!nameTouched) setFileName(result.fileName);
        })
        .catch((e) => !stale && setProbe({ kind: "error", message: String(e) }));
    }, 400);
    return () => {
      stale = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (!capture) urlRef.current?.focus();
  }, [capture]);

  async function pickFolder() {
    const dir = await open({ directory: true, defaultPath: saveDir || undefined });
    if (typeof dir === "string") setSaveDir(dir);
  }

  async function submit(startPaused: boolean) {
    setBusy(true);
    try {
      await api.add({
        url: url.trim(),
        fileName: fileName.trim() || null,
        saveDir: saveDir.trim() || null,
        connections,
        headers,
        startPaused,
      });
      onClose();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const valid = isProbablyUrl(url);
  const size =
    probe.kind === "ok" ? probe.result.totalSize : (capture?.fileSize ?? null);

  return (
    <Modal
      title={
        capture ? (
          <span className="flex items-center gap-2">
            <PuzzleIcon className="text-accent" /> Bắt được tệp tải từ trình duyệt
          </span>
        ) : (
          "Thêm liên kết tải"
        )
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-secondary" disabled={!valid || busy} onClick={() => submit(true)}>
            Thêm, tải sau
          </button>
          <button className="btn-primary" disabled={!valid || busy} onClick={() => submit(false)}>
            Tải ngay
          </button>
        </>
      }
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) submit(false);
        }}
      >
        <Field label="Địa chỉ (URL)">
          <input
            ref={urlRef}
            className="field font-mono text-xs"
            placeholder="https://example.com/file.zip"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
        </Field>

        <div className="min-h-[22px] text-xs">
          {probe.kind === "loading" && <span className="text-slate-500">Đang kiểm tra liên kết…</span>}
          {probe.kind === "error" && (
            <span className="flex items-center gap-1.5 text-red-600">
              <AlertIcon /> {probe.message}
            </span>
          )}
          {probe.kind === "ok" && (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600 dark:text-slate-400">
              <span>
                Kích thước: <b className="text-slate-800 dark:text-slate-200">{formatBytes(size)}</b>
              </span>
              {probe.result.resumable ? (
                <span className="flex items-center gap-1 text-emerald-600">
                  <CheckIcon /> Hỗ trợ tải đa luồng & tạm dừng
                </span>
              ) : (
                <span className="flex items-center gap-1 text-amber-600">
                  <AlertIcon /> Máy chủ không hỗ trợ chia đoạn — tải 1 luồng, không tạm dừng được
                </span>
              )}
            </span>
          )}
        </div>

        <Field label="Tên tệp">
          <input
            className="field"
            value={fileName}
            placeholder="Tự động"
            onChange={(e) => {
              setFileName(e.target.value);
              setNameTouched(true);
            }}
          />
        </Field>

        <Field label="Lưu vào thư mục">
          <div className="flex gap-2">
            <input className="field" value={saveDir} onChange={(e) => setSaveDir(e.target.value)} />
            <button type="button" className="btn-secondary shrink-0" onClick={pickFolder}>
              <FolderIcon /> Chọn…
            </button>
          </div>
        </Field>

        <Field
          label={`Số kết nối song song: ${connections}`}
          hint="Nhiều kết nối thường nhanh hơn; một số máy chủ giới hạn số kết nối — app sẽ tự giảm khi bị từ chối."
        >
          <input
            type="range"
            min={1}
            max={32}
            value={connections}
            onChange={(e) => setConnections(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
        </Field>
      </form>
    </Modal>
  );
}

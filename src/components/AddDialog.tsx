import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type Capture, type ProbeResult, type RequestHeaders } from "../lib/api";
import { errorText, formatBytes, formatDuration, hostOf, isProbablyUrl, resolutionLabel } from "../lib/format";
import { Field, Modal } from "./Modal";
import { FileTile } from "./FileTile";
import { AlertIcon, BoltIcon, FolderIcon, LinkIcon, PlusIcon, PuzzleIcon } from "./Icons";

interface Props {
  /** Prefilled from a browser capture. */
  capture?: Capture;
  defaultDir: string;
  defaultConnections: number;
  onClose: () => void;
  onAdded: (name: string, started: boolean) => void;
  onError: (msg: string) => void;
}

type ProbeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; result: ProbeResult }
  | { kind: "error"; message: string };

const CONNECTION_CHOICES = [1, 2, 4, 8, 16, 32];

export function AddDialog({ capture, defaultDir, defaultConnections, onClose, onAdded, onError }: Props) {
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

  // Inspect the URL (debounced): name, size, range support.
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
    }, 350);
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
      const d = await api.add({
        url: url.trim(),
        fileName: fileName.trim() || null,
        saveDir: saveDir.trim() || null,
        connections,
        headers,
        startPaused,
        kind: stream ? "hls" : (capture?.kind ?? null),
      });
      onAdded(d.fileName, !startPaused);
      onClose();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const valid = isProbablyUrl(url);
  const stream = probe.kind === "ok" ? probe.result.stream : null;
  const size = probe.kind === "ok" ? probe.result.totalSize : (capture?.fileSize ?? null);
  const blocked = stream?.live ?? false;
  const shownName = fileName || (valid ? "…" : "");

  return (
    <Modal
      title={capture ? "Bắt được tệp từ trình duyệt" : "Thêm liên kết tải"}
      subtitle={capture ? `Từ ${hostOf(capture.referrer || capture.url)}` : "Dán liên kết tệp cần tải (Ctrl V)"}
      icon={capture ? <PuzzleIcon /> : <LinkIcon />}
      onClose={onClose}
      width="max-w-[560px]"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-outline" disabled={!valid || busy || blocked} onClick={() => submit(true)}>
            <PlusIcon /> Thêm, tải sau
          </button>
          <button className="btn-primary min-w-[110px]" disabled={!valid || busy || blocked} onClick={() => submit(false)}>
            <BoltIcon /> Tải ngay
          </button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy && !blocked) submit(false);
        }}
      >
        <div className="relative">
          <LinkIcon className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
          <input
            ref={urlRef}
            className="field py-2.5 pl-10 font-mono text-[12px]"
            placeholder="https://example.com/file.zip"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* File preview card */}
        {valid && (
          <div className="animate-fade-in flex items-center gap-3.5 rounded-xl border border-line bg-panel/60 p-3.5">
            <FileTile name={shownName} />
            <div className="min-w-0 flex-1">
              <input
                className="w-full truncate bg-transparent text-[14px] font-medium text-ink outline-none placeholder:text-faint"
                value={fileName}
                placeholder="Tên tệp (tự động)"
                onChange={(e) => {
                  setFileName(e.target.value);
                  setNameTouched(true);
                }}
              />
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
                {probe.kind === "loading" && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand/25 border-t-brand" /> Đang kiểm tra…
                  </span>
                )}
                {probe.kind === "error" && (
                  <span className="flex items-center gap-1.5 text-red-500">
                    <AlertIcon /> {errorText(probe.message)}
                  </span>
                )}
                {(probe.kind === "ok" || size != null) && (
                  <span className="font-medium text-ink-2" title={stream ? "Ước tính từ chất lượng video" : undefined}>
                    {stream && size != null ? "≈ " : ""}
                    {formatBytes(size)}
                  </span>
                )}
                {stream && (
                  <>
                    <span className="rounded-full bg-rose-500/12 px-2 py-px text-[11px] font-medium text-rose-700 dark:text-rose-300">
                      Video HLS
                      {resolutionLabel(stream.resolution) ? ` · ${resolutionLabel(stream.resolution)}` : ""}
                      {stream.live ? "" : ` · ${formatDuration(stream.durationSecs)}`}
                    </span>
                    {stream.live ? (
                      <span className="flex items-center gap-1.5 text-red-500">
                        <AlertIcon /> Luồng phát trực tiếp, không tải được
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/12 px-2 py-px text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                        {stream.segments} đoạn · tạm dừng được{stream.encrypted ? " · đã mã hóa" : ""}
                      </span>
                    )}
                  </>
                )}
                {probe.kind === "ok" &&
                  !stream &&
                  (probe.result.resumable ? (
                    <span className="rounded-full bg-emerald-500/12 px-2 py-px text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      Đa luồng · tạm dừng được
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-500/14 px-2 py-px text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      Máy chủ chỉ cho tải 1 luồng
                    </span>
                  ))}
              </div>
            </div>
          </div>
        )}

        <Field label="Lưu vào">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FolderIcon className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
              <input className="field pl-10" value={saveDir} onChange={(e) => setSaveDir(e.target.value)} />
            </div>
            <button type="button" className="btn-outline" onClick={pickFolder}>
              Chọn…
            </button>
          </div>
        </Field>

        <Field
          label="Số kết nối song song"
          hint="Nhiều kết nối thường nhanh hơn. Nếu máy chủ giới hạn, app sẽ tự giảm."
        >
          <div className="flex gap-1 rounded-lg bg-panel p-1">
            {CONNECTION_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setConnections(c)}
                className={`flex-1 rounded-md py-1.5 text-[12.5px] font-medium tabular-nums transition ${
                  connections === c ? "bg-card text-brand shadow-card" : "text-mute hover:text-ink"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>
      </form>
    </Modal>
  );
}

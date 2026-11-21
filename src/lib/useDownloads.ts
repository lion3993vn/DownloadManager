import { useEffect, useState } from "react";
import { api, onEngineEvent, type DownloadInfo, type SegmentInfo } from "./api";

/** A download plus live transfer stats from progress events. */
export interface Row extends DownloadInfo {
  speed: number;
  etaSecs: number | null;
  activeConnections: number;
  liveSegments: SegmentInfo[];
}

function toRow(d: DownloadInfo, prev?: Row): Row {
  const active = d.status === "downloading";
  return {
    ...d,
    // Progress events are fresher than checkpointed state while running.
    downloaded: active && prev ? Math.max(prev.downloaded, d.downloaded) : d.downloaded,
    speed: active ? (prev?.speed ?? 0) : 0,
    etaSecs: active ? (prev?.etaSecs ?? null) : null,
    activeConnections: active ? (prev?.activeConnections ?? 0) : 0,
    liveSegments: active && prev?.liveSegments.length ? prev.liveSegments : d.segments,
  };
}

export function useDownloads() {
  const [rows, setRows] = useState<Map<number, Row>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let disposed = false;
    const unlisten = onEngineEvent((e) => {
      setRows((old) => {
        const next = new Map(old);
        switch (e.type) {
          case "added":
          case "updated": {
            next.set(e.download.id, toRow(e.download, old.get(e.download.id)));
            break;
          }
          case "removed":
            next.delete(e.id);
            break;
          case "progress": {
            const p = e.progress;
            const row = old.get(p.id);
            if (!row || row.status !== "downloading") return old;
            next.set(p.id, {
              ...row,
              downloaded: p.downloaded,
              totalSize: p.totalSize ?? row.totalSize,
              speed: p.speed,
              etaSecs: p.etaSecs,
              activeConnections: p.activeConnections,
              liveSegments: p.segments,
            });
            break;
          }
        }
        return next;
      });
    });
    api.list().then((list) => {
      if (disposed) return;
      setRows((old) => {
        const next = new Map(old);
        for (const d of list) if (!next.has(d.id)) next.set(d.id, toRow(d));
        return next;
      });
      setLoaded(true);
    });
    return () => {
      disposed = true;
      unlisten.then((f) => f());
    };
  }, []);

  return { rows, loaded };
}

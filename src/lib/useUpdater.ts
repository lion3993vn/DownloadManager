import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api, onUpdateAvailable, onUpdateInstalling, onUpdateProgress, type AvailableUpdate } from "./api";

export type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest"; checkedAt: number }
  | { kind: "available"; update: AvailableUpdate }
  | { kind: "error"; message: string };

export type InstallState =
  | { phase: "downloading"; downloaded: number; total: number | null }
  | { phase: "installing" };

/** Shared update state: startup check, periodic notifications, install. */
export function useUpdater(onNewVersion: (u: AvailableUpdate) => void) {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<CheckState>({ kind: "idle" });
  const [install, setInstall] = useState<InstallState | null>(null);
  const notify = useRef(onNewVersion);
  notify.current = onNewVersion;

  const check = useCallback(async (opts: { announce?: boolean } = {}) => {
    setState({ kind: "checking" });
    try {
      const s = await api.checkUpdate();
      if (s.available) {
        setState({ kind: "available", update: s.available });
        if (opts.announce) notify.current(s.available);
      } else {
        setState({ kind: "latest", checkedAt: Date.now() });
      }
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }, []);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    // Quiet check shortly after startup; announce only if something is new.
    const t = setTimeout(() => check({ announce: true }), 3000);
    const subs = [
      onUpdateAvailable((u) => {
        setState({ kind: "available", update: u });
        notify.current(u);
      }),
      onUpdateProgress((p) => setInstall({ phase: "downloading", downloaded: p.downloaded, total: p.total })),
      onUpdateInstalling(() => setInstall({ phase: "installing" })),
    ];
    return () => {
      clearTimeout(t);
      subs.forEach((u) => u.then((f) => f()));
    };
  }, [check]);

  /** Download + install + restart. Only returns if something failed. */
  const installNow = useCallback(async () => {
    setInstall({ phase: "downloading", downloaded: 0, total: null });
    try {
      await api.installUpdate();
    } catch (e) {
      setInstall(null);
      throw e;
    }
  }, []);

  return { version, state, install, check, installNow };
}

export type Updater = ReturnType<typeof useUpdater>;

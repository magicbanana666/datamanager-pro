import { useEffect, useState } from "react";
import { getAppVersion, getSystemInfo, pingBackend } from "@/api/backend";
import type { AppVersionInfo, SystemInfo } from "@/models/backend";

interface BackendStatus {
  state: "checking" | "connected" | "unavailable";
  ping: string | null;
  appVersion: AppVersionInfo | null;
  systemInfo: SystemInfo | null;
}

/**
 * Calls the diagnostic/system-info Rust commands (`ping_backend`,
 * `get_app_version`, `get_system_info`) to prove the Tauri
 * frontend/backend bridge is wired up end-to-end, and to surface real
 * OS/CPU/RAM info (Phase 2) in the Help dialog. Fails gracefully (e.g.
 * when running the raw Vite dev server outside of `tauri dev`).
 */
export function useBackendStatus(enabled: boolean) {
  const [status, setStatus] = useState<BackendStatus>({
    state: "checking",
    ping: null,
    appVersion: null,
    systemInfo: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    Promise.all([pingBackend(), getAppVersion(), getSystemInfo()])
      .then(([ping, appVersion, systemInfo]) => {
        if (cancelled) return;
        setStatus({ state: "connected", ping, appVersion, systemInfo });
      })
      .catch(() => {
        if (cancelled) return;
        setStatus({ state: "unavailable", ping: null, appVersion: null, systemInfo: null });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return status;
}

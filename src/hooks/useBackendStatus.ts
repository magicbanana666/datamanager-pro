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
 * Backend status, version and system info for the Help dialog. Reports
 * "unavailable" when running in a plain browser (`npm run dev`).
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

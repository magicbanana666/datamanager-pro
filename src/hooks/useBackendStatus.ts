import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AppVersionInfo {
  version: string;
  name: string;
  tauri_version: string;
}

interface SystemInfoMock {
  os: string;
  os_version: string;
  cpu: string;
  total_memory_mb: number;
  hostname: string;
}

interface BackendStatus {
  state: "checking" | "connected" | "unavailable";
  ping: string | null;
  appVersion: AppVersionInfo | null;
  systemInfo: SystemInfoMock | null;
}

/**
 * Calls the Phase 1 diagnostic Rust commands (`ping_backend`,
 * `get_app_version`, `get_system_info_mock`) to prove the Tauri
 * frontend/backend bridge is wired up end-to-end. Fails gracefully (e.g.
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

    Promise.all([
      invoke<string>("ping_backend"),
      invoke<AppVersionInfo>("get_app_version"),
      invoke<SystemInfoMock>("get_system_info_mock"),
    ])
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

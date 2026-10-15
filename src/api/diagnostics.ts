/** Crash reports, the log folder, and logging frontend errors. */
import { invoke } from "@tauri-apps/api/core";

export interface CrashReport {
  path: string;
  fileName: string;
  summary: string;
}

export function takeCrashReports(): Promise<CrashReport[]> {
  return invoke("take_crash_reports");
}

export function dismissCrashReports(): Promise<void> {
  return invoke("dismiss_crash_reports");
}

export function logsFolder(): Promise<string> {
  return invoke("logs_folder");
}

/** Best effort - never throws (it runs from error handlers). */
export function logFrontendError(message: string, stack?: string): void {
  invoke("log_frontend_error", { message, stack: stack ?? null }).catch(() => {});
}

/** Sends uncaught errors and unhandled promise rejections to the log. */
export function installGlobalErrorLogging(): void {
  window.addEventListener("error", (e) => logFrontendError(e.message, e.error instanceof Error ? e.error.stack : undefined));
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason;
    if (reason instanceof Error) logFrontendError(reason.message, reason.stack);
    else logFrontendError(typeof reason === "string" ? reason : JSON.stringify(reason));
  });
}

export function setLogLevel(level: string): Promise<void> {
  return invoke("set_log_level", { level });
}

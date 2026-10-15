/** App settings (Settings dialog), persisted by `settingsStore`. Every
 * one of them is read somewhere - see the comment on each. */
export interface AppSettings {
  general: {
    /** AppShell, at launch. */
    launchBehavior: "restore-last-session" | "show-overview" | "show-new-scan";
    /** Restores the last used locations at launch (utils/project.ts). */
    rememberLastLocation: boolean;
    /** StartupDialogs. */
    checkForUpdates: boolean;
  };
  appearance: {
    theme: "dark";
    /** AppShell / DataTable. */
    density: "comfortable" | "compact";
    /** AppShell sets `data-accent`; styles/index.css. */
    accent: "blue" | "teal" | "purple" | "green";
  };
  scanning: {
    /** Walk-engine threads; 0 = every core. */
    defaultThreadCount: number;
    includeHiddenFiles: boolean;
  };
  fileOperations: {
    /** Data Transfer's starting options. */
    defaultCollisionBehavior: "skip-same" | "compare-hash" | "rename-new" | "overwrite-older";
    verifyAfterCopy: boolean;
    preserveTimestamps: boolean;
  };
  reports: {
    /** The Reports page's starting format and output folder. */
    defaultFormat: "PDF" | "HTML" | "XLSX" | "CSV";
    /** Empty = Documents\DataManager Pro Reports. */
    defaultOutputFolder: string;
  };
  advanced: {
    /** Applied at once and kept for the next start (`set_log_level`). */
    logLevel: "error" | "warn" | "info" | "debug" | "trace";
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    launchBehavior: "show-overview",
    rememberLastLocation: true,
    checkForUpdates: true,
  },
  appearance: {
    theme: "dark",
    density: "comfortable",
    accent: "blue",
  },
  scanning: {
    defaultThreadCount: 0,
    includeHiddenFiles: true,
  },
  fileOperations: {
    defaultCollisionBehavior: "skip-same",
    verifyAfterCopy: true,
    preserveTimestamps: true,
  },
  reports: {
    defaultFormat: "PDF",
    defaultOutputFolder: "",
  },
  advanced: {
    logLevel: "info",
  },
};

export interface AppSettings {
  general: {
    launchBehavior: "restore-last-session" | "show-overview" | "show-new-scan";
    rememberLastLocation: boolean;
    checkForUpdates: boolean;
  };
  appearance: {
    theme: "dark";
    density: "comfortable" | "compact";
    accent: "blue" | "teal" | "purple" | "green";
  };
  scanning: {
    defaultThreadCount: number;
    followJunctions: boolean;
    includeHiddenFiles: boolean;
  };
  fileOperations: {
    defaultCollisionBehavior:
      | "skip-same"
      | "compare-hash"
      | "rename-new"
      | "overwrite-older";
    verifyAfterCopy: boolean;
    preserveTimestamps: boolean;
  };
  network: {
    timeoutSeconds: number;
    concurrency: number;
    resolveHostnames: boolean;
  };
  reports: {
    defaultFormat: "PDF" | "HTML" | "XLSX" | "CSV";
    defaultOutputFolder: string;
  };
  advanced: {
    logLevel: "error" | "warn" | "info" | "debug" | "trace";
    developerMode: boolean;
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
    defaultThreadCount: 8,
    followJunctions: true,
    includeHiddenFiles: false,
  },
  fileOperations: {
    defaultCollisionBehavior: "skip-same",
    verifyAfterCopy: true,
    preserveTimestamps: true,
  },
  network: {
    timeoutSeconds: 10,
    concurrency: 16,
    resolveHostnames: true,
  },
  reports: {
    defaultFormat: "PDF",
    defaultOutputFolder: "D:\\Data\\Reports",
  },
  advanced: {
    logLevel: "info",
    developerMode: false,
  },
};

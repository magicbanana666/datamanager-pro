import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@/styles/index.css";
import { installGlobalErrorLogging } from "@/api/diagnostics";
import { restoreSessionAtLaunch, startSessionAutosave } from "@/utils/project";
import { useUiStore } from "@/state/uiStore";

installGlobalErrorLogging();

// Before the first render, so pages start from the restored locations
// and the start page from Settings > General.
if (restoreSessionAtLaunch().openNewScan) useUiStore.getState().openNewScan();
startSessionAutosave();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

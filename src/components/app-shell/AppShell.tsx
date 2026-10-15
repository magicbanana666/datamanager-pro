import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Toolbar } from "@/components/toolbar/Toolbar";
import { StatusBar } from "@/components/status-bar/StatusBar";
import { ToastHost } from "@/components/toast/ToastHost";
import { SettingsDialog } from "@/components/dialogs/SettingsDialog";
import { HelpDialog } from "@/components/dialogs/HelpDialog";
import { PlaceholderDialog } from "@/components/dialogs/PlaceholderDialog";
import { StartupDialogs } from "@/components/dialogs/StartupDialogs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useSettingsStore } from "@/state/settingsStore";
import { useSchedulerStore } from "@/state/schedulerStore";

export function AppShell() {
  const density = useSettingsStore((s) => s.settings.appearance.density);
  const location = useLocation();

  useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
  }, [density]);

  // The scheduler runs in the backend whatever page is open; subscribing
  // here makes its finished runs toast everywhere.
  useEffect(() => {
    void useSchedulerStore.getState().init();
  }, []);

  return (
    <div className="flex h-screen w-screen min-w-0 flex-col bg-canvas text-fg">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto bg-canvas">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <StatusBar />

      <ToastHost />
      <SettingsDialog />
      <HelpDialog />
      <PlaceholderDialog />
      <StartupDialogs />
    </div>
  );
}

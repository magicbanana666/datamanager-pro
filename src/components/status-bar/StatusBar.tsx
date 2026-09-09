import { useEffect } from "react";
import { useUiStore } from "@/state/uiStore";

export function StatusBar() {
  const { statusText, memoryMb, setMemoryMb, appVersion } = useUiStore();

  // Small ambient fluctuation so the memory figure feels alive, purely
  // cosmetic - no real process telemetry is read anywhere in Phase 1.
  useEffect(() => {
    const id = window.setInterval(() => {
      setMemoryMb(Math.round(260 + Math.sin(Date.now() / 9000) * 30 + Math.random() * 12));
    }, 3000);
    return () => window.clearInterval(id);
  }, [setMemoryMb]);

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-canvas-alt px-3 text-[11.5px] text-fg-muted">
      <div className="flex items-center gap-1.5">
        <span className="h-[7px] w-[7px] rounded-full bg-success" />
        <span>{statusText}</span>
      </div>
      <div className="flex items-center gap-3">
        <span>Memory: {memoryMb} MB</span>
        <span className="text-fg-subtle">v{appVersion}</span>
      </div>
    </footer>
  );
}

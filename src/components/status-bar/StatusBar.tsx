import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUiStore } from "@/state/uiStore";

export function StatusBar() {
  const { statusText, memoryMb, setMemoryMb, appVersion } = useUiStore();

  // Process memory (working set), every 3 s.
  useEffect(() => {
    const read = () =>
      invoke<number>("get_process_memory")
        .then((bytes) => setMemoryMb(Math.round(bytes / (1024 * 1024))))
        .catch(() => {});
    read();
    const id = window.setInterval(read, 3000);
    return () => window.clearInterval(id);
  }, [setMemoryMb]);

  return (
    <footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-canvas-alt px-3 text-[11.5px] text-fg-muted">
      <div className="flex items-center gap-1.5">
        <span className="h-[7px] w-[7px] rounded-full bg-success" />
        <span>{statusText}</span>
      </div>
      <div className="flex items-center gap-3">
        <span>Memory: {memoryMb ? `${memoryMb} MB` : "-"}</span>
        <span className="text-fg-subtle">v{appVersion}</span>
      </div>
    </footer>
  );
}

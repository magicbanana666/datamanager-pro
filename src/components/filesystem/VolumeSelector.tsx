import { HardDrive, Loader2, Network, RefreshCw, Usb } from "lucide-react";
import clsx from "clsx";
import type { AppError, StorageVolume } from "@/models/backend";
import { Button } from "@/components/controls/Button";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { formatBytes } from "@/utils/format";

interface VolumeSelectorProps {
  volumes: StorageVolume[];
  loading: boolean;
  error: AppError | null;
  selectedMountPoint?: string | null;
  onSelect: (volume: StorageVolume) => void;
  onRefresh: () => void;
}

const iconFor = (volume: StorageVolume) => {
  if (volume.volumeType === "network") return Network;
  if (volume.volumeType === "removable" || volume.volumeType === "optical") return Usb;
  return HardDrive;
};

/** Real storage volumes, enumerated by the Rust backend
 * (`list_storage_volumes`) - no hardcoded drive letters. Clicking a
 * volume sets it as the active browse location. */
export function VolumeSelector({ volumes, loading, error, selectedMountPoint, onSelect, onRefresh }: VolumeSelectorProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-fg-muted">Storage Volumes (real)</span>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onRefresh} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading && volumes.length === 0 && (
        <div className="flex items-center gap-2 text-[12px] text-fg-subtle">
          <Loader2 size={14} className="animate-spin" /> Enumerating storage volumes...
        </div>
      )}

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-2.5 py-2 text-[12px] text-danger">
          {error.message}
        </div>
      )}

      {!loading && !error && volumes.length === 0 && (
        <div className="text-[12px] text-fg-subtle">No storage volumes were reported.</div>
      )}

      <div className="flex flex-wrap gap-2">
        {volumes.map((volume) => {
          const Icon = iconFor(volume);
          const isSelected = selectedMountPoint === volume.mountPoint;
          return (
            <button
              key={volume.id}
              onClick={() => onSelect(volume)}
              className={clsx(
                "flex w-[190px] flex-col gap-1.5 rounded-md border p-2.5 text-left transition-colors cursor-pointer",
                isSelected ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-alt hover:border-fg-subtle",
              )}
            >
              <div className="flex items-center gap-2">
                <Icon size={15} className={isSelected ? "text-accent" : "text-fg-muted"} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">{volume.name}</span>
              </div>
              <ProgressBar value={volume.usagePercent} height={5} tone={isSelected ? "accent" : "neutral"} />
              <div className="flex items-center justify-between text-[11px] text-fg-subtle">
                <span>{formatBytes(volume.freeBytes)} free</span>
                <span>{volume.fileSystem ?? "Unknown FS"}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

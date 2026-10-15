/**
 * The current scan (one at a time), shared by Disk and Folder Analysis.
 * Components call `start`/`cancel` and read the state; events are
 * handled here.
 */
import { create } from "zustand";
import { cancelScan, generateScanId, getSubtree, startScan, subscribeScanEvents } from "@/api/scan";
import { toAppError } from "@/api/backend";
import type { AppError, ScanOptions, ScanProgress, ScanResult } from "@/models/backend";
import type { FsNode } from "@/models/common";
import { needsChildren } from "@/utils/fsTree";

export type ScanStatus = "idle" | "scanning" | "completed" | "cancelled" | "error";

interface ScanState {
  status: ScanStatus;
  scanId: string | null;
  /** Target of the current or last scan, so a remounted page shows it. */
  path: string | null;
  progress: ScanProgress | null;
  result: ScanResult | null;
  error: AppError | null;

  start: (path: string, options: ScanOptions) => Promise<void>;
  /** Sets the location without scanning (opening a project). */
  setPath: (path: string) => void;
  cancel: () => Promise<void>;
  reset: () => void;
  /** Resolves to `node` with its `children` populated, fetching them
   * from the backend's cached full tree first if they were truncated
   * out of what the frontend received (see `needsChildren`). */
  loadChildren: (node: FsNode) => Promise<FsNode>;
}

function createScanStore() {
  return create<ScanState>((set, get) => {
    // Kept outside the reactive state.
    let unlisten: (() => void) | null = null;

    return {
      status: "idle",
      scanId: null,
      path: null,
      progress: null,
      result: null,
      error: null,

      start: async (path, options) => {
        unlisten?.();
        unlisten = null;

        const scanId = generateScanId();
        set({
          status: "scanning",
          scanId,
          path,
          progress: null,
          result: null,
          error: null,
        });

        // Subscribed *before* the backend is told to start - see
        // api/scan.ts's doc comment on why order matters here.
        unlisten = await subscribeScanEvents(scanId, {
          onProgress: (progress) => {
            if (get().scanId === scanId) set({ progress });
          },
          onComplete: (result) => {
            if (get().scanId === scanId) set({ status: "completed", result });
          },
          onCancelled: () => {
            if (get().scanId === scanId) set({ status: "cancelled" });
          },
          onError: (error) => {
            if (get().scanId === scanId) set({ status: "error", error });
          },
        });

        try {
          await startScan(scanId, path, options);
        } catch (err) {
          if (get().scanId === scanId) {
            set({ status: "error", error: toAppError(err) });
          }
        }
      },

      setPath: (path) => {
        if (get().status !== "scanning") set({ path });
      },

      cancel: async () => {
        const { scanId, status } = get();
        if (!scanId || status !== "scanning") return;
        try {
          await cancelScan(scanId);
        } catch {
          // The scan may have already finished server-side between the
          // Cancel click and this call landing - the eventual
          // scan-complete/scan-cancelled event is the source of truth,
          // not this promise.
        }
      },

      reset: () => {
        unlisten?.();
        unlisten = null;
        set({ status: "idle", scanId: null, path: null, progress: null, result: null, error: null });
      },

      loadChildren: async (node) => {
        const { scanId, status } = get();
        if (!scanId || status !== "completed" || !needsChildren(node)) return node;
        const loaded = await getSubtree(scanId, node.path);
        // Deliberately grafted onto the existing node in place, not
        // copied: the result tree is this session's cache, so navigating
        // back to (or re-expanding) this folder never refetches, and
        // every breadcrumb/selection reference to it sees the children.
        // Callers still trigger a re-render themselves (a new breadcrumb
        // entry or expanded-ids set) since React can't see the mutation.
        node.children = loaded.children;
        return node;
      },
    };
  });
}

/** Disk Analysis and Folder Analysis share this scan. */
export const useScanStore = createScanStore();
/** Network Analysis has its own, so scanning a share doesn't replace the
 * folder scan. */
export const useNetworkScanStore = createScanStore();

/**
 * The right-click menu for a file or folder anywhere in the app (scan
 * tables and treemaps, search results, duplicates, comparisons, transfer
 * plans): open it, show it in Explorer, copy its path, properties,
 * analyze/search/find duplicates in a folder, copy or move it, or move it
 * to the Recycle Bin.
 */
import type { NavigateFunction } from "react-router-dom";
import {
  ArrowRightLeft,
  Copy,
  ExternalLink,
  FileSearch,
  Files,
  FolderOpen,
  FolderSearch,
  Info,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { confirmAction, pickFolder } from "@/api/dialog";
import { recyclePaths, revealInExplorer } from "@/api/fileops";
import { openPath } from "@/api/search";
import { openFolder } from "@/api/transfer";
import { toAppError } from "@/api/backend";
import type { ContextMenuItem } from "@/state/contextMenuStore";
import { DEFAULT_TRANSFER_OPTIONS } from "@/models/transfer";
import { useDuplicateStore } from "@/state/duplicateStore";
import { useScanStore } from "@/state/scanStore";
import { useSearchStore } from "@/state/searchStore";
import { scanOptionsFromSettings } from "@/state/settingsStore";
import { toast } from "@/state/toastStore";
import { useFileActionStore } from "@/state/transferStore";
import { useUiStore } from "@/state/uiStore";

export interface FsTarget {
  path: string;
  kind: "file" | "folder";
}

const fail = (err: unknown) => toast.danger(toAppError(err).message);

function nameOf(path: string): string {
  return path.split("\\").filter(Boolean).pop() ?? path;
}

function parentOf(path: string): string {
  const trimmed = path.replace(/\\+$/, "");
  const i = trimmed.lastIndexOf("\\");
  if (i < 0) return path;
  return i <= 2 ? trimmed.slice(0, i + 1) : trimmed.slice(0, i);
}

function copyText(text: string, what: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${what} copied.`))
    .catch(() => toast.danger("Couldn't copy to the clipboard."));
}

async function transfer(target: FsTarget, mode: "copy" | "move") {
  const destination = await pickFolder(parentOf(target.path));
  if (!destination) return;
  const options = { ...DEFAULT_TRANSFER_OPTIONS, verifyAfterTransfer: true };
  const store = useFileActionStore.getState();
  if (target.kind === "file") {
    await store.start({ source: parentOf(target.path), destination, mode, collision: "rename-new", options, files: [target.path] });
  } else {
    // A folder goes inside the chosen one, keeping its name.
    await store.start({
      source: target.path,
      destination: `${destination.replace(/\\+$/, "")}\\${nameOf(target.path)}`,
      mode,
      collision: "skip-same",
      options,
    });
  }
  toast.info(`${mode === "copy" ? "Copying" : "Moving"} ${nameOf(target.path)}... (progress in Data Transfer's log)`);
}

async function recycle(targets: FsTarget[], onDeleted?: (paths: string[]) => void) {
  const what = targets.length === 1 ? nameOf(targets[0].path) : `${targets.length} items`;
  const folders = targets.some((t) => t.kind === "folder");
  const ok = await confirmAction(
    `Move ${what}${folders ? " (with everything in it)" : ""} to the Recycle Bin?`,
    "Delete",
    "Move to Recycle Bin",
  );
  if (!ok) return;
  try {
    const outcome = await recyclePaths(targets.map((t) => t.path));
    if (outcome.errors.length) toast.danger(`${outcome.errors[0].path}: ${outcome.errors[0].message}`, "Not deleted");
    if (outcome.deleted.length) {
      toast.success(`${outcome.deleted.length === 1 ? nameOf(outcome.deleted[0]) : `${outcome.deleted.length} items`} moved to the Recycle Bin. Rescan to update totals.`);
      onDeleted?.(outcome.deleted);
    }
  } catch (err) {
    fail(err);
  }
}

/** Menu items for one file or folder. `onDeleted` lets the caller drop
 * it from what it shows. */
export function fsMenuItems(target: FsTarget, navigate: NavigateFunction, onDeleted?: (paths: string[]) => void): ContextMenuItem[] {
  const { path, kind } = target;
  const folder = kind === "folder";
  const items: ContextMenuItem[] = [
    { kind: "header", label: path },
    folder
      ? { label: "Open in Explorer", icon: FolderOpen, onSelect: () => openFolder(path).catch(fail) }
      : { label: "Open", icon: ExternalLink, onSelect: () => openPath(path).catch(fail) },
    { label: "Show in Explorer", icon: FolderSearch, onSelect: () => revealInExplorer(path).catch(fail) },
    { kind: "separator" },
    { label: "Copy path", icon: Copy, onSelect: () => copyText(path, "Path") },
    { label: "Copy name", icon: Copy, onSelect: () => copyText(nameOf(path), "Name") },
    { label: "Properties", icon: Info, onSelect: () => useUiStore.getState().openProperties(path) },
  ];
  if (folder) {
    items.push(
      { kind: "separator" },
      {
        label: "Analyze this folder",
        icon: ScanSearch,
        disabled: useScanStore.getState().status === "scanning",
        onSelect: () => {
          void useScanStore.getState().start(path, scanOptionsFromSettings());
          navigate("/folder-analysis");
        },
      },
      {
        label: "Find duplicates in this folder",
        icon: Files,
        disabled: useDuplicateStore.getState().status === "running",
        onSelect: () => {
          void useDuplicateStore.getState().start([path], {
            criteria: "exact",
            ignoreCase: true,
            ignoreHidden: true,
            ignoreSystem: true,
            minSize: 0,
            maxSize: null,
          });
          navigate("/duplicate-finder");
        },
      },
      {
        label: "Search in this folder",
        icon: FileSearch,
        onSelect: () => {
          const store = useSearchStore.getState();
          const last = store.args?.[1];
          store.setArgs([
            path,
            last ?? {
              query: "",
              matchName: true,
              matchContent: false,
              caseSensitive: false,
              regex: false,
              wholeWords: false,
              includeSubfolders: true,
              searchArchives: false,
              includeBinary: false,
              includeHidden: false,
              includeSystem: false,
              extensions: [],
              minSize: null,
              maxSize: null,
              modifiedAfter: null,
            },
          ]);
          useUiStore.getState().remountPages();
          navigate("/file-search");
        },
      },
    );
  }
  const busy = useFileActionStore.getState().status === "running";
  items.push(
    { kind: "separator" },
    { label: "Copy to...", icon: Copy, disabled: busy, onSelect: () => void transfer(target, "copy") },
    { label: "Move to...", icon: ArrowRightLeft, disabled: busy, onSelect: () => void transfer(target, "move") },
    { kind: "separator" },
    { label: "Move to Recycle Bin", icon: Trash2, danger: true, onSelect: () => void recycle([target], onDeleted) },
  );
  return items;
}

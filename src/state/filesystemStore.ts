/**
 * Real, backend-backed filesystem browsing state.
 *
 * This holds the *single* active browse session (one current path, its
 * listing, its shallow summary) plus the shared, app-wide volume list.
 * Disk Analysis and Folder Analysis - the two "browse one location at a
 * time" pages - use this store directly.
 *
 * Pages that need *two independent* locations at once (Comparison's A/B,
 * Data Transfer's source/destination, Sync's source/destination) do NOT
 * share this single session - they call `api/backend.ts` directly with
 * their own local path state instead, since a single global
 * `currentPath` can't represent two locations simultaneously. This store
 * is deliberately not a generic multi-instance cache for that reason.
 */
import { create } from "zustand";
import { toAppError } from "@/api/backend";
import * as backend from "@/api/backend";
import type {
  AppError,
  DirectorySummary,
  FileSystemEntry,
  ListDirectoryOptions,
  PathValidation,
  StorageVolume,
} from "@/models/backend";

interface FilesystemState {
  volumes: StorageVolume[];
  volumesLoading: boolean;
  volumesError: AppError | null;

  currentPath: string | null;
  entries: FileSystemEntry[];
  directorySummary: DirectorySummary | null;
  selectedEntry: FileSystemEntry | null;
  loading: boolean;
  error: AppError | null;

  showHidden: boolean;
  showSystem: boolean;

  loadVolumes: (forceRefresh?: boolean) => Promise<void>;
  browse: (path: string) => Promise<void>;
  selectEntry: (entry: FileSystemEntry | null) => void;
  refresh: () => Promise<void>;
  validatePath: (path: string) => Promise<PathValidation>;
  setShowHidden: (value: boolean) => void;
  setShowSystem: (value: boolean) => void;
}

export const useFilesystemStore = create<FilesystemState>((set, get) => ({
  volumes: [],
  volumesLoading: false,
  volumesError: null,

  currentPath: null,
  entries: [],
  directorySummary: null,
  selectedEntry: null,
  loading: false,
  error: null,

  showHidden: false,
  showSystem: false,

  loadVolumes: async (forceRefresh = false) => {
    set({ volumesLoading: true, volumesError: null });
    try {
      const volumes = await backend.listStorageVolumes(forceRefresh);
      set({ volumes, volumesLoading: false });
    } catch (err) {
      set({ volumesLoading: false, volumesError: toAppError(err) });
    }
  },

  browse: async (path: string) => {
    set({ loading: true, error: null, currentPath: path, selectedEntry: null });
    const { showHidden, showSystem } = get();
    const options: ListDirectoryOptions = { showHidden, showSystem };
    try {
      const [listing, summary] = await Promise.all([
        backend.listDirectory(path, options),
        backend.getDirectorySummary(path).catch(() => null),
      ]);
      set({
        entries: listing.entries,
        directorySummary: summary,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({ loading: false, entries: [], directorySummary: null, error: toAppError(err) });
    }
  },

  selectEntry: (entry) => set({ selectedEntry: entry }),

  refresh: async () => {
    const { currentPath, browse } = get();
    if (currentPath) await browse(currentPath);
  },

  validatePath: async (path: string) => {
    try {
      return await backend.validatePath(path);
    } catch (err) {
      const appError = toAppError(err);
      return {
        inputPath: path,
        normalizedPath: null,
        exists: false,
        isFile: false,
        isDirectory: false,
        isSymlink: false,
        isAbsolute: false,
        isUnc: false,
        accessible: false,
        error: appError,
      };
    }
  },

  setShowHidden: (value) => {
    set({ showHidden: value });
    void get().refresh();
  },
  setShowSystem: (value) => {
    set({ showSystem: value });
    void get().refresh();
  },
}));

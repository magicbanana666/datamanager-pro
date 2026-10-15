/**
 * File Search's saved searches, persisted in the webview's local
 * storage (it survives restarts; a cleared or unavailable storage just
 * starts empty).
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ModifiedRange } from "@/utils/search";

export interface SavedSearch {
  name: string;
  location: string;
  term: string;
  options: Record<string, boolean>;
  category: string;
  minMb: string;
  maxMb: string;
  range: ModifiedRange;
}

interface SavedSearchState {
  searches: SavedSearch[];
  save: (search: SavedSearch) => void;
  remove: (name: string) => void;
}

export const useSavedSearchStore = create<SavedSearchState>()(
  persist(
    (set) => ({
      searches: [],
      save: (search) =>
        set((s) => ({
          searches: [...s.searches.filter((x) => x.name !== search.name), search].sort((a, b) => a.name.localeCompare(b.name)),
        })),
      remove: (name) => set((s) => ({ searches: s.searches.filter((x) => x.name !== name) })),
    }),
    { name: "dmp-saved-searches", storage: createJSONStorage(() => localStorage) },
  ),
);

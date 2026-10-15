/**
 * Pure helpers turning a backend `DuplicateResult` into the Duplicate
 * Finder's UI model, plus the client-side keep rules and the derived
 * File Types / Folders breakdowns.
 */
import type { CategoryStat } from "@/models/common";
import { FILE_TYPE_CATEGORIES } from "@/models/common";
import type { BackendDuplicateGroup, DuplicateFileEntry, DuplicateGroup, DuplicateResult } from "@/models/duplicates";
import { categorizeByExtension } from "@/utils/scanAnalysis";

export type KeepRule = "newest" | "oldest" | "shortest-path" | "largest";

/** How many groups start expanded - the rest stay collapsed so a run
 * with thousands of groups opens on a readable list. */
const INITIALLY_EXPANDED = 10;

function splitPath(fullPath: string): { dir: string; name: string } {
  const idx = fullPath.lastIndexOf("\\");
  return idx < 0 ? { dir: "", name: fullPath } : { dir: fullPath.slice(0, idx + 1), name: fullPath.slice(idx + 1) };
}

function typeLabel(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? `${name.slice(idx + 1).toUpperCase()} File` : "File";
}

function toUiGroup(g: BackendDuplicateGroup, index: number): DuplicateGroup {
  const files: DuplicateFileEntry[] = g.files.map((f) => ({
    id: f.path,
    name: f.name,
    path: splitPath(f.path).dir,
    size: f.size,
    type: typeLabel(f.name),
    modified: f.lastModified,
    selected: false,
  }));
  const first = files[0];
  return {
    id: `${index}:${g.key}`,
    label: first?.name ?? g.key,
    size: Math.max(...files.map((f) => f.size)),
    type: first ? typeLabel(first.name) : "",
    files,
    wastedBytes: g.wastedBytes,
    expanded: index < INITIALLY_EXPANDED,
  };
}

export function toUiGroups(result: DuplicateResult, rule: KeepRule): DuplicateGroup[] {
  return applyKeepRule(result.groups.map(toUiGroup), rule);
}

function keptFile(files: DuplicateFileEntry[], rule: KeepRule): DuplicateFileEntry {
  const time = (f: DuplicateFileEntry) => (f.modified ? new Date(f.modified).getTime() : 0);
  const better: Record<KeepRule, (a: DuplicateFileEntry, b: DuplicateFileEntry) => boolean> = {
    newest: (a, b) => time(a) > time(b),
    oldest: (a, b) => time(a) < time(b),
    "shortest-path": (a, b) => a.id.length < b.id.length,
    largest: (a, b) => a.size > b.size,
  };
  return files.reduce((best, f) => (better[rule](f, best) ? f : best));
}

/** Marks one file per group as the copy to keep (per `rule`) and
 * selects every other copy - the "Apply Rule to All Groups" action,
 * also used for a fresh result's default selection. */
export function applyKeepRule(groups: DuplicateGroup[], rule: KeepRule): DuplicateGroup[] {
  return groups.map((g) => {
    const keep = keptFile(g.files, rule);
    return {
      ...g,
      files: g.files.map((f) => ({ ...f, isOriginal: f.id === keep.id, selected: f.id !== keep.id })),
    };
  });
}

/** Recoverable bytes per file-type category, across `groups`. */
export function duplicateCategoryStats(groups: DuplicateGroup[]): CategoryStat[] {
  const totals = new Map<string, number>();
  for (const g of groups) {
    const category = categorizeByExtension(g.label);
    totals.set(category, (totals.get(category) ?? 0) + g.wastedBytes);
  }
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  return FILE_TYPE_CATEGORIES.map((c) => ({
    label: c.label,
    value: totals.get(c.id) ?? 0,
    percent: total > 0 ? ((totals.get(c.id) ?? 0) / total) * 100 : 0,
    colorIndex: c.colorIndex,
  }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

export interface DuplicateFolderStat {
  path: string;
  files: number;
  bytes: number;
}

/** Folders holding the most duplicate copies (by bytes) - where a
 * cleanup would pay off most. */
export function duplicateFolderStats(groups: DuplicateGroup[], limit = 25): DuplicateFolderStat[] {
  const folders = new Map<string, DuplicateFolderStat>();
  for (const g of groups) {
    for (const f of g.files) {
      const entry = folders.get(f.path) ?? { path: f.path, files: 0, bytes: 0 };
      entry.files += 1;
      entry.bytes += f.size;
      folders.set(f.path, entry);
    }
  }
  return [...folders.values()].sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

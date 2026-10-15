/**
 * Pure helpers for the File Search page: turning backend hits into
 * table rows, the request's filter fields, and the File Types /
 * Folders / Timeline breakdowns.
 */
import type { CategoryStat } from "@/models/common";
import { FILE_TYPE_CATEGORIES } from "@/models/common";
import type { SearchHit, SearchResultRow } from "@/models/search";
import { categorizeByExtension, TIMELINE_BUCKETS, timelineBucketLabel } from "@/utils/scanAnalysis";

export type ModifiedRange = "any" | "today" | "week" | "month" | "year";

const RANGE_DAYS: Record<Exclude<ModifiedRange, "any">, number> = { today: 1, week: 7, month: 30, year: 365 };

/** The `modifiedAfter` cut-off for a range, as RFC 3339. */
export function modifiedAfter(range: ModifiedRange): string | null {
  if (range === "any") return null;
  return new Date(Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000).toISOString();
}

/** The extensions of a file-type category, or none for "all". */
export function categoryExtensions(categoryId: string): string[] {
  return FILE_TYPE_CATEGORIES.find((c) => c.id === categoryId)?.extensions.map((e) => e.toLowerCase()) ?? [];
}

function typeLabel(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? `${name.slice(idx + 1).toUpperCase()} File` : "File";
}

export function toRows(hits: SearchHit[]): SearchResultRow[] {
  return hits.map((hit) => {
    const idx = hit.path.lastIndexOf("\\");
    return {
      id: hit.path,
      name: hit.name,
      path: idx < 0 ? "" : hit.path.slice(0, idx + 1),
      size: hit.size,
      type: typeLabel(hit.name),
      modified: hit.lastModified ?? "",
      occurrences: hit.occurrences,
      hit,
    };
  });
}

/** Matching bytes per file-type category. */
export function hitCategoryStats(rows: SearchResultRow[]): CategoryStat[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const category = categorizeByExtension(r.name);
    totals.set(category, (totals.get(category) ?? 0) + r.size);
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

/** Folders with the most matches. */
export function hitFolders(rows: SearchResultRow[], limit = 25): { path: string; matches: number; bytes: number }[] {
  const folders = new Map<string, { path: string; matches: number; bytes: number }>();
  for (const r of rows) {
    const f = folders.get(r.path) ?? { path: r.path, matches: 0, bytes: 0 };
    f.matches += 1;
    f.bytes += r.size;
    folders.set(r.path, f);
  }
  return [...folders.values()].sort((a, b) => b.matches - a.matches).slice(0, limit);
}

/** Match counts per modified-date bucket, same buckets as the disk
 * analysis Timeline. */
export function hitTimeline(rows: SearchResultRow[]): { label: string; matches: number }[] {
  const now = Date.now();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const bucket = timelineBucketLabel(r.modified || null, now);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return TIMELINE_BUCKETS.map((b) => ({ label: b.label, matches: counts.get(b.label) ?? 0 }));
}

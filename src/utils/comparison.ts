/**
 * Pure helpers turning a backend `ComparisonResult` into the Compare
 * Locations page's UI model and charts.
 */
import type { CategoryStat } from "@/models/common";
import { FILE_TYPE_CATEGORIES } from "@/models/common";
import type { ComparisonResult, ComparisonRow, ComparisonSide } from "@/models/comparison";
import { categorizeByExtension, finalizeAnalysis } from "@/utils/scanAnalysis";

const CATEGORY_LABEL = new Map(FILE_TYPE_CATEGORIES.map((c) => [c.id, c.label]));

function joinPath(base: string, relativeDir: string): string {
  const sep = base.endsWith("\\") ? "" : "\\";
  return relativeDir ? `${base}${sep}${relativeDir}\\` : `${base}${sep}`;
}

export function toUiRows(result: ComparisonResult): ComparisonRow[] {
  return result.rows.map((r) => {
    const idx = r.relativePath.lastIndexOf("\\");
    const name = idx < 0 ? r.relativePath : r.relativePath.slice(idx + 1);
    const dir = idx < 0 ? "" : r.relativePath.slice(0, idx);
    return {
      id: r.relativePath,
      status: r.status,
      name,
      pathA: r.sizeA != null ? joinPath(result.a.location, dir) : null,
      pathB: r.sizeB != null ? joinPath(result.b.location, dir) : null,
      sizeA: r.sizeA,
      sizeB: r.sizeB,
      modifiedA: r.modifiedA,
      modifiedB: r.modifiedB,
      category: CATEGORY_LABEL.get(categorizeByExtension(name)) ?? "Other",
    };
  });
}

/** One side's file-type donut, via the same category mapping as the
 * disk analysis. */
export function sideCategoryStats(side: ComparisonSide): CategoryStat[] {
  return finalizeAnalysis({ extensions: side.extensions, topFiles: [], topFolders: [], timeline: [] }).categoryStats;
}

/** Bytes and file counts per category, side by side, for the bar charts. */
export function categoryComparison(result: ComparisonResult) {
  const totals = new Map<string, { aBytes: number; bBytes: number; aFiles: number; bFiles: number }>();
  const add = (side: ComparisonSide, which: "a" | "b") => {
    for (const e of side.extensions) {
      const label = CATEGORY_LABEL.get(categorizeByExtension(`x${e.extension}`)) ?? "Other";
      const t = totals.get(label) ?? { aBytes: 0, bBytes: 0, aFiles: 0, bFiles: 0 };
      if (which === "a") {
        t.aBytes += e.size;
        t.aFiles += e.files;
      } else {
        t.bBytes += e.size;
        t.bFiles += e.files;
      }
      totals.set(label, t);
    }
  };
  add(result.a, "a");
  add(result.b, "b");
  const rows = [...totals.entries()].sort((x, y) => y[1].aBytes + y[1].bBytes - (x[1].aBytes + x[1].bBytes));
  return {
    bytes: rows.map(([type, t]) => ({ type, a: t.aBytes, b: t.bBytes })),
    files: rows.map(([type, t]) => ({ type, a: t.aFiles, b: t.bFiles })),
  };
}

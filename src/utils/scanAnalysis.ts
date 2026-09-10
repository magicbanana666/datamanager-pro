/**
 * Derives every analytical-tab dataset (file-type breakdown, top
 * files/folders, extension breakdown, modified-date timeline) from a
 * real (or mock) `FsNode` tree in one pass, so Disk Analysis/Folder
 * Analysis's tabs can show real numbers without a backend change -
 * Phase 3's `FsNode` already carries everything needed except
 * category, which stays a frontend concern per Phase 2/3's "backend
 * sends raw data" convention (see `models/scan.rs`'s doc comment).
 */
import type { CategoryStat, FileTypeCategoryId, FsNode } from "@/models/common";
import { FILE_TYPE_CATEGORIES } from "@/models/common";

export interface LargestFileEntry {
  name: string;
  path: string;
  size: number;
}

export interface ExtensionStat {
  extension: string;
  files: number;
  size: number;
  percent: number;
}

export interface TimelineBucket {
  label: string;
  size: number;
}

export interface ScanAnalysis {
  categoryStats: CategoryStat[];
  extensionStats: ExtensionStat[];
  topFiles: LargestFileEntry[];
  topFolders: { path: string; size: number }[];
  timeline: TimelineBucket[];
}

const EXTENSION_TO_CATEGORY = new Map<string, FileTypeCategoryId>();
for (const category of FILE_TYPE_CATEGORIES) {
  for (const ext of category.extensions) {
    EXTENSION_TO_CATEGORY.set(ext.toLowerCase(), category.id);
  }
}

/** `""` for a file with no extension (or a dotfile like `.gitignore`,
 * which `path.extension()` on the Rust side also treats as having no
 * extension - matching `services::scan_service`'s leaf construction). */
function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx).toLowerCase() : "";
}

/** Exported for `Treemap`, which colors file tiles by category too -
 * keeps "blue means archives" consistent between the treemap and the
 * File Types donut rather than each inventing its own scheme. */
export function categorizeByExtension(name: string): FileTypeCategoryId {
  return EXTENSION_TO_CATEGORY.get(extensionOf(name)) ?? "other";
}

const TIMELINE_BUCKETS: { label: string; maxDays: number }[] = [
  { label: "Today", maxDays: 1 },
  { label: "This week", maxDays: 7 },
  { label: "This month", maxDays: 30 },
  { label: "Last 6 months", maxDays: 182 },
  { label: "This year", maxDays: 365 },
  { label: "Older", maxDays: Infinity },
];

function timelineBucketLabel(lastModified: string | null, now: number): string {
  if (!lastModified) return "Older"; // unknown date - bucket conservatively rather than guess "Today"
  const days = (now - new Date(lastModified).getTime()) / (1000 * 60 * 60 * 24);
  for (const bucket of TIMELINE_BUCKETS) {
    if (days <= bucket.maxDays) return bucket.label;
  }
  return "Older";
}

const TOP_N = 10;
const TOP_EXTENSIONS = 9;

/**
 * Single recursive pass over `node` (the scan root, or any drilled-
 * into subfolder - callers re-run this per breadcrumb position, not
 * just once for the whole tree) producing every real-tab dataset at
 * once rather than a separate walk per tab. Cheap enough to call on
 * navigation even for Phase 3's live-verified ~750K-file scale (one
 * native array sort per list, not a repeated tree walk).
 */
export function analyzeTree(node: FsNode): ScanAnalysis {
  const now = Date.now();
  const categoryTotals = new Map<FileTypeCategoryId, number>();
  const extensionTotals = new Map<string, { size: number; files: number }>();
  const timelineTotals = new Map<string, number>();
  const files: LargestFileEntry[] = [];
  const folders: { path: string; size: number }[] = [];

  function visit(n: FsNode, isRoot: boolean) {
    if (n.kind === "file") {
      const category = categorizeByExtension(n.name);
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + n.size);

      const ext = extensionOf(n.name) || "(none)";
      const entry = extensionTotals.get(ext) ?? { size: 0, files: 0 };
      entry.size += n.size;
      entry.files += 1;
      extensionTotals.set(ext, entry);

      const bucket = timelineBucketLabel(n.lastModified, now);
      timelineTotals.set(bucket, (timelineTotals.get(bucket) ?? 0) + n.size);

      files.push({ name: n.name, path: n.path, size: n.size });
    } else {
      // A folder/drive node - root itself is excluded from "top
      // folders" (matching the original mock lists, which never
      // included the scanned root as one of its own top entries).
      if (!isRoot) folders.push({ path: n.path, size: n.size });
      for (const child of n.children ?? []) visit(child, false);
    }
  }
  visit(node, true);

  const totalCategorySize = [...categoryTotals.values()].reduce((a, b) => a + b, 0);
  const categoryStats: CategoryStat[] = FILE_TYPE_CATEGORIES.map((category) => {
    const value = categoryTotals.get(category.id) ?? 0;
    return {
      label: category.label,
      value,
      percent: totalCategorySize > 0 ? (value / totalCategorySize) * 100 : 0,
      colorIndex: category.colorIndex,
    };
  })
    .filter((stat) => stat.value > 0)
    .sort((a, b) => b.value - a.value);

  const totalExtensionSize = [...extensionTotals.values()].reduce((a, b) => a + b.size, 0);
  const sortedExtensions = [...extensionTotals.entries()].sort((a, b) => b[1].size - a[1].size);
  const extensionStats: ExtensionStat[] = sortedExtensions.slice(0, TOP_EXTENSIONS).map(([extension, stat]) => ({
    extension,
    files: stat.files,
    size: stat.size,
    percent: totalExtensionSize > 0 ? (stat.size / totalExtensionSize) * 100 : 0,
  }));
  const restExtensions = sortedExtensions.slice(TOP_EXTENSIONS);
  if (restExtensions.length > 0) {
    const size = restExtensions.reduce((a, [, v]) => a + v.size, 0);
    const filesCount = restExtensions.reduce((a, [, v]) => a + v.files, 0);
    extensionStats.push({
      extension: "(other)",
      files: filesCount,
      size,
      percent: totalExtensionSize > 0 ? (size / totalExtensionSize) * 100 : 0,
    });
  }

  const timeline: TimelineBucket[] = TIMELINE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    size: timelineTotals.get(bucket.label) ?? 0,
  }));

  return {
    categoryStats,
    extensionStats,
    topFiles: [...files].sort((a, b) => b.size - a.size).slice(0, TOP_N),
    topFolders: [...folders].sort((a, b) => b.size - a.size).slice(0, TOP_N),
    timeline,
  };
}

/**
 * Direct (non-recursive) children of `children`, largest `n` plus an
 * "Others" bucket for the rest - what Folder Analysis's "Size
 * Distribution" donut actually shows (its mock labels are child
 * names: Clients/Product/Archive/Others), as opposed to
 * `analyzeTree`'s recursive, extension-based category breakdown.
 */
export function topChildrenWithOthers(children: FsNode[], n: number): CategoryStat[] {
  const sorted = [...children].sort((a, b) => b.size - a.size);
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n);
  const total = children.reduce((a, c) => a + c.size, 0);

  const stats: CategoryStat[] = top.map((child, i) => ({
    label: child.name,
    value: child.size,
    percent: total > 0 ? (child.size / total) * 100 : 0,
    colorIndex: i,
  }));
  if (rest.length > 0) {
    const value = rest.reduce((a, c) => a + c.size, 0);
    stats.push({
      label: "Others",
      value,
      percent: total > 0 ? (value / total) * 100 : 0,
      colorIndex: top.length,
    });
  }
  return stats;
}

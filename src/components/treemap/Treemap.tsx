import { useMemo } from "react";
import { Folder } from "lucide-react";
import clsx from "clsx";
import { FILE_TYPE_CATEGORIES, type FsNode } from "@/models/common";
import { useElementSize } from "@/hooks/useElementSize";
import { squarify } from "@/components/treemap/treemapLayout";
import { categorizeByExtension } from "@/utils/scanAnalysis";
import { chartColor } from "@/utils/colors";
import { formatBytes } from "@/utils/format";

interface TreemapProps {
  /** The node whose subtree is laid out, recursively, as nested tiles -
   * not just its direct children (see the module doc below). */
  node: FsNode;
  selectedId?: string | null;
  onSelect?: (node: FsNode) => void;
  onDrillDown?: (node: FsNode) => void;
  /** Which tiles a double-click drills into. Defaults to folders whose
   * children are already loaded; a real scan passes
   * `hasExpandableChildren` so truncated folders (fetched on demand)
   * stay drillable too. */
  canDrillDown?: (node: FsNode) => boolean;
  className?: string;
}

const GAP = 1;
/** Height of the thin title strip drawn for a folder that gets
 * recursed into, showing its name above its own nested children -
 * the visual cue that ties a group of tiles back to the folder that
 * contains them (WizTree does the same). */
const HEADER_HEIGHT = 14;
/** Per folder, not global - keeps any one folder's own row of tiles
 * legible even deep in the recursion. See `MAX_TOTAL_TILES` for the
 * budget across the whole recursive layout. */
const MAX_TILES_PER_LEVEL = 30;
/** Hard cap on tiles across every level combined. Unlike WizTree's
 * canvas-drawn mosaic, these are real `<button>` elements (for click/
 * keyboard/hover), so unlike WizTree this can't scale to "one tile per
 * file" on a folder with tens of thousands of them without a real
 * performance cost - this keeps that bounded regardless of how deep or
 * wide the recursion goes. */
const MAX_TOTAL_TILES = 500;
/** Below this (in either dimension), a folder renders as a single
 * solid tile instead of being recursed into - there's no useful room
 * left for a header plus at least one visible child. */
const MIN_RECURSE_SIZE = 46;
/** Safety valve against pathologically deep folder trees, independent
 * of the pixel-size cutoff above. */
const MAX_DEPTH = 6;

const CATEGORY_COLOR_INDEX = Object.fromEntries(
  FILE_TYPE_CATEGORIES.map((c) => [c.id, c.colorIndex]),
) as Record<string, number>;
/** Folders aren't categorized the way files are (see `categorizeByExtension`) -
 * a fixed neutral tone reads as "this is a folder", distinct from any
 * file-type color, the same way WizTree's folder tiles read as gray
 * regardless of what's inside them. Given how much of a real mosaic is
 * folder tiles (rather than files small enough to be leaves), a flat-out
 * dark gray read as visually flat overall - a slightly lighter, faintly
 * blue slate keeps that same "not a file category" neutrality without
 * making large stretches of the treemap look empty. */
const FOLDER_COLOR = "#4b5b73";
/** Darker still - the "you're inside this folder" title strip should
 * never be mistaken for a tile you'd click to open a file. */
const HEADER_COLOR = "#1f2733";

function fileColor(name: string): string {
  return chartColor(CATEGORY_COLOR_INDEX[categorizeByExtension(name)] ?? CATEGORY_COLOR_INDEX.other);
}

/** Folds everything past the `maxTiles - 1` largest children into one
 * synthetic "Other" node, so a folder with hundreds of direct children
 * doesn't degenerate into an unreadable wall of slivers. Its `children`
 * stay the real originals - double-clicking it (or the recursive
 * layout naturally recursing into it, if it's large enough) reveals
 * exactly the folded-away items, re-bucketed the same way if there are
 * still too many. */
function bucketSmallest(children: FsNode[], maxTiles: number): FsNode[] {
  if (children.length <= maxTiles) return children;
  const sorted = [...children].sort((a, b) => b.size - a.size);
  const shown = sorted.slice(0, maxTiles - 1);
  const folded = sorted.slice(maxTiles - 1);

  let size = 0;
  let allocated = 0;
  let fileCount = 0;
  let folderCount = 0;
  for (const c of folded) {
    size += c.size;
    allocated += c.allocated;
    if (c.kind === "file") {
      fileCount += 1;
    } else {
      fileCount += c.fileCount;
      folderCount += 1 + c.folderCount;
    }
  }

  const other: FsNode = {
    id: `${folded[0].id}::other`,
    name: `Other (${folded.length} items)`,
    path: folded[0].path,
    kind: "folder",
    size,
    allocated,
    fileCount,
    folderCount,
    percentOfParent: folded.reduce((s, c) => s + c.percentOfParent, 0),
    lastModified: null,
    children: folded,
  };
  return [...shown, other];
}

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  node: FsNode;
  depth: number;
  /** True for a folder's own thin title strip, drawn once above the
   * recursive layout of its children - never true for a leaf tile
   * (a file, or a folder too small/deep to recurse into). */
  isHeader: boolean;
}

/**
 * Recursively squarifies `node`'s subtree into a flat list of tiles -
 * every folder large enough to be worth it gets its own nested mosaic
 * (a title strip plus its children's tiles inset below it) instead of
 * this component only ever showing one level at a time. Mutates `out`
 * and `budget` in place (a shared tile-count budget across the whole
 * recursion, not per call) rather than returning and merging arrays,
 * since this can recurse fairly deep.
 */
function layoutRecursive(
  node: FsNode,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  budget: { remaining: number },
  out: Tile[],
) {
  if (w <= 0 || h <= 0) return;
  const children = bucketSmallest(node.children ?? [], MAX_TILES_PER_LEVEL);
  if (children.length === 0) return;

  const items = children.map((c) => ({ value: Math.max(c.size, 1), node: c }));
  const rects = squarify(items, x, y, w, h);

  for (const r of rects) {
    if (budget.remaining <= 0) return;
    budget.remaining--;

    const canRecurse =
      r.node.kind !== "file" &&
      (r.node.children?.length ?? 0) > 0 &&
      depth < MAX_DEPTH &&
      r.w >= MIN_RECURSE_SIZE &&
      r.h >= MIN_RECURSE_SIZE;

    if (canRecurse) {
      out.push({ x: r.x, y: r.y, w: r.w, h: HEADER_HEIGHT, node: r.node, depth, isHeader: true });
      layoutRecursive(
        r.node,
        r.x + 1,
        r.y + HEADER_HEIGHT,
        Math.max(0, r.w - 2),
        Math.max(0, r.h - HEADER_HEIGHT - 1),
        depth + 1,
        budget,
        out,
      );
    } else {
      out.push({ x: r.x, y: r.y, w: r.w, h: r.h, node: r.node, depth, isHeader: false });
    }
  }
}

function hasLoadedChildren(node: FsNode): boolean {
  return !!node.children && node.children.length > 0;
}

export function Treemap({
  node,
  selectedId,
  onSelect,
  onDrillDown,
  canDrillDown = hasLoadedChildren,
  className,
}: TreemapProps) {
  const { ref, size } = useElementSize<HTMLDivElement>();

  const tiles = useMemo(() => {
    if (size.width === 0 || size.height === 0) return [];
    const out: Tile[] = [];
    layoutRecursive(node, 0, 0, size.width, size.height, 0, { remaining: MAX_TOTAL_TILES }, out);
    return out;
  }, [node, size.width, size.height]);

  return (
    <div ref={ref} className={clsx("relative w-full min-h-0", className)}>
      {tiles.length === 0 && (
        <div className="flex h-full items-center justify-center text-xs text-fg-subtle">No data to display</div>
      )}
      {tiles.map((t) => {
        const isSelected = t.node.id === selectedId;
        const isFile = t.node.kind === "file";
        const canDrill = canDrillDown(t.node);
        const color = t.isHeader ? HEADER_COLOR : isFile ? fileColor(t.node.name) : FOLDER_COLOR;
        // Deliberately tight thresholds (WizTree-style density over
        // Phase 1's original spacious tiles) - most tiles in a real,
        // granular treemap are small, and only need to earn a label
        // once there's genuinely room for it; below that they're still
        // a real, clickable, hoverable (see `title`) tile, just an
        // unlabeled block of color.
        const canShowLabel = t.w > 34 && t.h > (t.isHeader ? 10 : 16);
        const canShowSize = !t.isHeader && t.w > 34 && t.h > 30;

        return (
          <button
            key={`${t.node.id}:${t.depth}:${t.x.toFixed(0)}:${t.y.toFixed(0)}`}
            onClick={() => onSelect?.(t.node)}
            onDoubleClick={() => canDrill && onDrillDown?.(t.node)}
            title={`${t.node.name} — ${formatBytes(t.node.size)}`}
            style={{
              position: "absolute",
              left: t.x + GAP / 2,
              top: t.y + GAP / 2,
              width: Math.max(0, t.w - GAP),
              height: Math.max(0, t.h - GAP),
              backgroundColor: color,
              zIndex: t.depth,
            }}
            className={clsx(
              "overflow-hidden text-left transition-[filter] cursor-pointer",
              t.isHeader ? "flex items-center gap-1 px-1.5" : "flex flex-col items-start justify-start p-1",
              "hover:brightness-125",
              isSelected ? "ring-2 ring-white ring-inset" : "ring-1 ring-black/40 ring-inset",
            )}
          >
            {t.isHeader
              ? canShowLabel && (
                  <>
                    <Folder size={9} className="shrink-0 text-white/80" />
                    <span className="truncate text-[10px] font-semibold text-white/90">{t.node.name}</span>
                  </>
                )
              : (canShowLabel || canShowSize) && (
                  <>
                    {canShowLabel && (
                      <span className="flex items-center gap-1 text-[10.5px] font-semibold text-white drop-shadow-sm">
                        {!isFile && t.w > 56 && <Folder size={10} className="shrink-0 opacity-90" />}
                        <span className="truncate">{t.node.name}</span>
                      </span>
                    )}
                    {canShowSize && (
                      <span className="text-[9.5px] text-white/85 drop-shadow-sm">{formatBytes(t.node.size)}</span>
                    )}
                  </>
                )}
          </button>
        );
      })}
    </div>
  );
}

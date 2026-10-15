import type { FsNode } from "@/models/common";

export interface VisibleRow {
  node: FsNode;
  depth: number;
}

/** A real scan's folder whose children weren't included in what the
 * frontend received (see `TRANSPORT_DEPTH` in
 * `src-tauri/src/models/scan.rs`) but exist in the backend's cached
 * tree - fetch them with `useScanStore().loadChildren`. Excludes empty
 * folders and the backend's `cap_children` "Other (N items)"
 * placeholders, which genuinely have nothing to fetch. */
export function needsChildren(node: FsNode): boolean {
  return (
    node.kind !== "file" &&
    node.children === undefined &&
    node.fileCount + node.folderCount > 0 &&
    !node.id.endsWith("::other")
  );
}

/** Whether a node can be expanded/drilled into, loaded or not yet. */
export function hasExpandableChildren(node: FsNode): boolean {
  return (node.children?.length ?? 0) > 0 || needsChildren(node);
}

/** Flattens a tree into the rows a WizTree/TreeSize-style expandable table
 * would show, honoring which folder ids are currently expanded. */
export function flattenVisible(root: FsNode, expandedIds: Set<string>, depth = 0): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const children = [...(root.children ?? [])].sort((a, b) => b.size - a.size);
  for (const child of children) {
    rows.push({ node: child, depth });
    if (child.children && child.children.length > 0 && expandedIds.has(child.id)) {
      rows.push(...flattenVisible(child, expandedIds, depth + 1));
    }
  }
  return rows;
}

/** What the analysis pages show before their first scan: an empty
 * folder, so every tab renders its empty state. */
export const EMPTY_SCAN_ROOT: FsNode = {
  id: "no-scan",
  name: "No scan yet",
  path: "",
  kind: "folder",
  size: 0,
  allocated: 0,
  fileCount: 0,
  folderCount: 0,
  percentOfParent: 100,
  lastModified: null,
  children: [],
};

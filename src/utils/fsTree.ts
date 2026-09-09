import type { FsNode } from "@/models/common";

export interface VisibleRow {
  node: FsNode;
  depth: number;
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

import type { FsNode } from "@/models/common";

export type QuickFilterId = "all" | "large" | "old" | "temp" | "system";

export const QUICK_FILTERS: { id: QuickFilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "large", label: "Large Files" },
  { id: "old", label: "Old Files" },
  { id: "temp", label: "Temporary Files" },
  { id: "system", label: "System Files" },
];

const LARGE_THRESHOLD = 5 * 1024 ** 3; // 5 GB
const OLD_THRESHOLD_DAYS = 180;
const SYSTEM_NAME_HINTS = ["system", "windows", "program", "temp", "cache"];

export function filterChildren(children: FsNode[], filter: QuickFilterId): FsNode[] {
  switch (filter) {
    case "large":
      return children.filter((c) => c.size >= LARGE_THRESHOLD);
    case "old":
      return children.filter((c) => {
        const days = (Date.now() - new Date(c.lastModified).getTime()) / (1000 * 60 * 60 * 24);
        return days >= OLD_THRESHOLD_DAYS;
      });
    case "temp":
      return children.filter((c) => /temp|tmp|cache/i.test(c.name));
    case "system":
      return children.filter((c) => SYSTEM_NAME_HINTS.some((h) => c.name.toLowerCase().includes(h)));
    default:
      return children;
  }
}

/** Builds a synthetic node sharing the parent's identity but with a
 * filtered/derived children list - lets Treemap and DataTable re-use the
 * same rendering path without needing filter-awareness of their own. */
export function withChildren(node: FsNode, children: FsNode[]): FsNode {
  return { ...node, children };
}

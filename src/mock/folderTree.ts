import type { FileTypeCategoryId, FsNode, NodeKind } from "@/models/common";

/** Convenience shape for hand-authoring mock trees - only the essentials
 * need to be specified, the rest (paths, ids, allocated size, % of parent)
 * is derived by `finalizeTree`. */
interface RawNode {
  name: string;
  size: number;
  fileCount: number;
  folderCount: number;
  lastModified: string;
  kind?: NodeKind;
  category?: FileTypeCategoryId;
  children?: RawNode[];
}

function gb(n: number): number {
  return Math.round(n * 1024 * 1024 * 1024);
}

function finalize(
  raw: RawNode,
  parentPath: string,
  parentSize: number,
  idPrefix: string,
): FsNode {
  const path = parentPath ? `${parentPath}\\${raw.name}` : raw.name;
  const id = `${idPrefix}/${raw.name}`;
  const children = raw.children?.map((c) => finalize(c, path, raw.size, id));
  return {
    id,
    name: raw.name,
    path,
    kind: raw.kind ?? (raw.children ? "folder" : "folder"),
    size: raw.size,
    allocated: Math.round(raw.size * 1.0021),
    fileCount: raw.fileCount,
    folderCount: raw.folderCount,
    percentOfParent: parentSize > 0 ? (raw.size / parentSize) * 100 : 100,
    lastModified: raw.lastModified,
    category: raw.category,
    children,
  };
}

export function buildTree(root: RawNode): FsNode {
  return finalize(root, "", root.size, "n");
}

export function findNodeByPath(root: FsNode, path: string): FsNode | undefined {
  if (root.path === path) return root;
  for (const child of root.children ?? []) {
    const found = findNodeByPath(child, path);
    if (found) return found;
  }
  return undefined;
}

/** Direct children of a node, sorted largest-first (mirrors how WizTree /
 * TreeSize present folder listings by default). */
export function sortedChildren(node: FsNode): FsNode[] {
  return [...(node.children ?? [])].sort((a, b) => b.size - a.size);
}

// ---------------------------------------------------------------------------
// D:\Data - used by the Disk Analysis page
// ---------------------------------------------------------------------------
export const diskTree: FsNode = buildTree({
  name: "D:\\Data",
  size: gb(1226.1),
  fileCount: 152341,
  folderCount: 12458,
  lastModified: "2026-09-07T14:22:00",
  children: [
    {
      name: "VMs",
      size: gb(412.5),
      fileCount: 45,
      folderCount: 3,
      lastModified: "2026-09-07T14:22:00",
      category: "virtual-disk",
      children: [
        { name: "Windows11.vhdx", size: gb(58.2), fileCount: 1, folderCount: 0, lastModified: "2026-09-07T14:22:00", kind: "file", category: "virtual-disk" },
        { name: "Server2022.vhdx", size: gb(112.4), fileCount: 1, folderCount: 0, lastModified: "2026-09-06T09:10:00", kind: "file", category: "virtual-disk" },
        { name: "DevBox.vmdk", size: gb(64.1), fileCount: 1, folderCount: 0, lastModified: "2026-09-04T18:00:00", kind: "file", category: "virtual-disk" },
        { name: "Snapshots", size: gb(177.8), fileCount: 42, folderCount: 3, lastModified: "2026-09-07T08:00:00" },
      ],
    },
    {
      name: "Projects",
      size: gb(286.1),
      fileCount: 12458,
      folderCount: 1234,
      lastModified: "2026-09-07T10:11:00",
      children: [
        {
          name: "Clients",
          size: gb(86.4),
          fileCount: 4523,
          folderCount: 421,
          lastModified: "2026-09-07T09:55:00",
          children: [
            { name: "AMGroup", size: gb(28.1), fileCount: 1482, folderCount: 96, lastModified: "2026-09-06T14:22:00" },
            { name: "Cobofisk", size: gb(18.6), fileCount: 1104, folderCount: 74, lastModified: "2026-09-06T11:03:00" },
            { name: "Desmet", size: gb(14.2), fileCount: 823, folderCount: 58, lastModified: "2026-09-05T16:41:00" },
            { name: "Others", size: gb(25.5), fileCount: 1114, folderCount: 193, lastModified: "2026-09-04T18:07:00" },
          ],
        },
        { name: "Archive", size: gb(62.1), fileCount: 2847, folderCount: 210, lastModified: "2026-09-05T08:33:00" },
        { name: "Documentation", size: gb(45.8), fileCount: 2114, folderCount: 190, lastModified: "2026-09-04T20:17:00" },
        { name: "ISO", size: gb(38.1), fileCount: 97, folderCount: 6, lastModified: "2026-09-03T11:26:00", category: "iso" },
        { name: "Media", size: gb(31.4), fileCount: 1245, folderCount: 89, lastModified: "2026-09-02T09:14:00", category: "picture" },
        { name: "Temp", size: gb(14.7), fileCount: 1834, folderCount: 121, lastModified: "2026-09-01T16:43:00" },
        { name: "Other", size: gb(7.6), fileCount: 348, folderCount: 42, lastModified: "2026-08-31T13:22:00" },
      ],
    },
    {
      name: "Backups",
      size: gb(198.7),
      fileCount: 8342,
      folderCount: 412,
      lastModified: "2026-09-06T22:15:00",
      category: "archive",
    },
    {
      name: "ISOs",
      size: gb(112.4),
      fileCount: 97,
      folderCount: 6,
      lastModified: "2026-09-05T18:23:00",
      category: "iso",
    },
    {
      name: "Media",
      size: gb(96.3),
      fileCount: 1245,
      folderCount: 89,
      lastModified: "2026-09-04T20:17:00",
      category: "video",
    },
    {
      name: "Documents",
      size: gb(45.8),
      fileCount: 16334,
      folderCount: 221,
      lastModified: "2026-09-03T11:26:00",
      category: "document",
    },
    {
      name: "Tools",
      size: gb(31.4),
      fileCount: 3827,
      folderCount: 64,
      lastModified: "2026-09-02T09:14:00",
      category: "executable",
    },
    {
      name: "Temp",
      size: gb(24.7),
      fileCount: 12114,
      folderCount: 532,
      lastModified: "2026-09-01T16:43:00",
    },
    {
      name: "Other",
      size: gb(18.2),
      fileCount: 5221,
      folderCount: 331,
      lastModified: "2026-08-31T13:22:00",
    },
  ],
});

// ---------------------------------------------------------------------------
// D:\Data\Projects - used by the Folder Analysis page
// ---------------------------------------------------------------------------
export const projectsFolderTree: FsNode = buildTree({
  name: "D:\\Data\\Projects",
  size: gb(286.1),
  fileCount: 1234567,
  folderCount: 12458,
  lastModified: "2026-09-07T10:11:00",
  children: [
    {
      name: "Clients",
      size: gb(86.4),
      fileCount: 125432,
      folderCount: 8421,
      lastModified: "2026-09-07T09:55:00",
      children: [
        { name: "AMGroup", size: gb(28.1), fileCount: 42115, folderCount: 2341, lastModified: "2026-09-06T14:22:00" },
        { name: "Cobofisk", size: gb(18.6), fileCount: 31442, folderCount: 1892, lastModified: "2026-09-06T11:03:00" },
        { name: "Desmet", size: gb(14.2), fileCount: 22541, folderCount: 1204, lastModified: "2026-09-05T16:41:00" },
        { name: "Others", size: gb(25.5), fileCount: 29334, folderCount: 2984, lastModified: "2026-09-04T18:07:00" },
      ],
    },
    { name: "Product", size: gb(62.1), fileCount: 342117, folderCount: 2114, lastModified: "2026-09-06T22:15:00" },
    { name: "Archive", size: gb(28.7), fileCount: 185544, folderCount: 534, lastModified: "2026-09-05T08:33:00", category: "archive" },
    { name: "Documentation", size: gb(24.3), fileCount: 421114, folderCount: 1667, lastModified: "2026-09-04T20:17:00", category: "document" },
    { name: "ISO", size: gb(18.9), fileCount: 97, folderCount: 421, lastModified: "2026-09-03T11:26:00", category: "iso" },
    { name: "Media", size: gb(14.2), fileCount: 52114, folderCount: 389, lastModified: "2026-09-02T09:14:00", category: "video" },
    { name: "Temp", size: gb(9.6), fileCount: 85221, folderCount: 532, lastModified: "2026-09-01T16:43:00" },
    { name: "Tools", size: gb(8.1), fileCount: 61442, folderCount: 421, lastModified: "2026-08-31T13:22:00", category: "executable" },
    { name: "Scripts", size: gb(6.4), fileCount: 44113, folderCount: 266, lastModified: "2026-08-30T10:11:00", category: "code" },
    { name: "Others", size: gb(5.3), fileCount: 23142, folderCount: 198, lastModified: "2026-08-29T08:17:00" },
  ],
});

// ---------------------------------------------------------------------------
// \\NAS\CompanyData - used by the Network Analysis page
// ---------------------------------------------------------------------------
export const networkTree: FsNode = buildTree({
  name: "\\\\NAS\\CompanyData",
  size: gb(2482.1),
  fileCount: 1234567,
  folderCount: 12458,
  lastModified: "2026-09-07T14:22:00",
  kind: "drive",
  children: [
    { name: "Clients", size: gb(847.1), fileCount: 412356, folderCount: 4125, lastModified: "2026-09-07T13:11:00" },
    { name: "Projects", size: gb(562.3), fileCount: 284125, folderCount: 2834, lastModified: "2026-09-06T18:44:00" },
    { name: "Management", size: gb(328.6), fileCount: 145221, folderCount: 1442, lastModified: "2026-09-06T11:02:00" },
    { name: "Shared", size: gb(284.1), fileCount: 132557, folderCount: 1021, lastModified: "2026-09-05T16:37:00" },
    { name: "Software", size: gb(186.4), fileCount: 98214, folderCount: 892, lastModified: "2026-09-04T09:18:00", category: "executable" },
    { name: "Archive", size: gb(154.2), fileCount: 76112, folderCount: 645, lastModified: "2026-09-03T21:40:00", category: "archive" },
    { name: "ISO", size: gb(72.1), fileCount: 31884, folderCount: 221, lastModified: "2026-09-01T12:05:00", category: "iso" },
    { name: "Backups", size: gb(47.3), fileCount: 18774, folderCount: 198, lastModified: "2026-08-31T07:22:00", category: "archive" },
  ],
});

import type { MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { FsNode } from "@/models/common";
import { useContextMenuStore } from "@/state/contextMenuStore";
import { fsMenuItems, type FsTarget } from "@/utils/fsMenu";

/** Opens the file/folder right-click menu. `forNode` handles scan-tree
 * nodes, skipping the synthetic "Other (N items)" groups. */
export function useFsContextMenu() {
  const navigate = useNavigate();
  const show = useContextMenuStore((s) => s.show);
  const open = (event: MouseEvent, target: FsTarget, onDeleted?: (paths: string[]) => void) =>
    show(event, fsMenuItems(target, navigate, onDeleted));
  const forNode = (event: MouseEvent, node: FsNode, onDeleted?: (paths: string[]) => void) => {
    if (!node.path || node.id.endsWith("::other")) {
      event.preventDefault();
      return;
    }
    open(event, { path: node.path, kind: node.kind === "folder" ? "folder" : "file" }, onDeleted);
  };
  return { open, forNode };
}

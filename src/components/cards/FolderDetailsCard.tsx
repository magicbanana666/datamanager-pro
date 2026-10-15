import { Copy, File, Folder, FolderOpen } from "lucide-react";
import type { FsNode } from "@/models/common";
import { Card } from "@/components/cards/Card";
import { Button } from "@/components/controls/Button";
import { openFolder } from "@/api/transfer";
import { toAppError } from "@/api/backend";
import { formatBytes, formatDate, formatNumber, formatPercent } from "@/utils/format";
import { toast } from "@/state/toastStore";

/** The folder for "Open in Explorer": the item itself, or a file's parent. */
function folderOf(node: FsNode): string {
  if (node.kind === "folder") return node.path;
  const i = node.path.lastIndexOf("\\");
  return i <= 2 ? node.path.slice(0, i + 1) : node.path.slice(0, i);
}

export function FolderDetailsCard({ node }: { node: FsNode | null }) {
  const title = node?.kind === "file" ? "File Details" : "Folder Details";
  if (!node || !node.path) {
    return (
      <Card title="Folder Details">
        <p className="text-xs text-fg-subtle">Select an item in the treemap or table to see its details.</p>
      </Card>
    );
  }

  return (
    <Card title={title}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          {node.kind === "file" ? <File size={22} className="shrink-0 text-fg-subtle" /> : <Folder size={22} className="shrink-0 text-warning" />}
          <div className="truncate text-[13.5px] font-semibold text-fg">{node.name}</div>
        </div>
        <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 text-[12.5px]">
          <dt className="text-fg-muted">Path:</dt>
          <dd className="truncate text-fg" title={node.path}>{node.path}</dd>
          <dt className="text-fg-muted">Size:</dt>
          <dd className="text-fg">
            {formatBytes(node.size)} ({formatBytes(node.allocated)} on disk)
          </dd>
          {node.kind === "folder" && (
            <>
              <dt className="text-fg-muted">Files:</dt>
              <dd className="text-fg">{formatNumber(node.fileCount)}</dd>
              <dt className="text-fg-muted">Folders:</dt>
              <dd className="text-fg">{formatNumber(node.folderCount)}</dd>
            </>
          )}
          <dt className="text-fg-muted">% of parent:</dt>
          <dd className="text-fg">{formatPercent(node.percentOfParent)}</dd>
          <dt className="text-fg-muted">Modified:</dt>
          <dd className="text-fg">{formatDate(node.lastModified)}</dd>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            icon={FolderOpen}
            onClick={() => openFolder(folderOf(node)).catch((e) => toast.danger(toAppError(e).message))}
          >
            Open in Explorer
          </Button>
          <Button
            size="sm"
            icon={Copy}
            onClick={() =>
              navigator.clipboard
                .writeText(node.path)
                .then(() => toast.success("Path copied."))
                .catch(() => toast.danger("Couldn't copy to the clipboard."))
            }
          >
            Copy path
          </Button>
        </div>
      </div>
    </Card>
  );
}

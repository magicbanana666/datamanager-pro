import { Folder, FolderOpen } from "lucide-react";
import type { FsNode } from "@/models/common";
import { Card } from "@/components/cards/Card";
import { Checkbox } from "@/components/controls/Checkbox";
import { Button } from "@/components/controls/Button";
import { formatBytes, formatDate, formatNumber, formatPercent } from "@/utils/format";
import { toast } from "@/state/toastStore";

export function FolderDetailsCard({ node }: { node: FsNode | null }) {
  if (!node) {
    return (
      <Card title="Folder Details">
        <p className="text-xs text-fg-subtle">Select an item in the treemap or table to see its details.</p>
      </Card>
    );
  }

  return (
    <Card title="Folder Details">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <Folder size={22} className="shrink-0 text-warning" />
          <div className="truncate text-[13.5px] font-semibold text-fg">{node.name}</div>
        </div>
        <dl className="grid grid-cols-[80px_1fr] gap-y-1.5 text-[12.5px]">
          <dt className="text-fg-muted">Path:</dt>
          <dd className="truncate text-fg">{node.path}</dd>
          <dt className="text-fg-muted">Size:</dt>
          <dd className="text-fg">
            {formatBytes(node.size)} ({node.allocated.toLocaleString()} bytes allocated)
          </dd>
          <dt className="text-fg-muted">Files:</dt>
          <dd className="text-fg">{formatNumber(node.fileCount)}</dd>
          <dt className="text-fg-muted">Folders:</dt>
          <dd className="text-fg">{formatNumber(node.folderCount)}</dd>
          <dt className="text-fg-muted">% of parent:</dt>
          <dd className="text-fg">{formatPercent(node.percentOfParent)}</dd>
          <dt className="text-fg-muted">Modified:</dt>
          <dd className="text-fg">{formatDate(node.lastModified)}</dd>
        </dl>
        <div className="flex flex-col gap-1.5 pt-1">
          <Checkbox checked={false} onChange={() => toast.demo()} label="Open folder" />
          <Checkbox checked={false} onChange={() => toast.demo()} label="Copy path to clipboard" />
          <Checkbox checked={false} onChange={() => toast.demo()} label="Exclude from scan" />
        </div>
        <Button icon={FolderOpen} onClick={() => toast.demo()} className="self-start">
          Open in Explorer
        </Button>
      </div>
    </Card>
  );
}

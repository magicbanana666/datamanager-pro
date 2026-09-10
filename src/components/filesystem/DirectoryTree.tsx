import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, Loader2 } from "lucide-react";
import clsx from "clsx";
import { listDirectory, toAppError } from "@/api/backend";
import type { AppError, FileSystemEntry } from "@/models/backend";

interface DirectoryTreeNodeProps {
  path: string;
  name: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

/** A single lazily-expanding tree node: its children are only fetched
 * from the backend the first time it's expanded, and never further
 * than that - expanding a grandchild later fetches *its* children in
 * its own request. Nothing pre-loads the whole tree. */
function DirectoryTreeNode({ path, name, depth, selectedPath, onSelect }: DirectoryTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileSystemEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function toggle() {
    if (!expanded && children === null) {
      setLoading(true);
      try {
        const listing = await listDirectory(path);
        setChildren(listing.entries.filter((e) => e.entryType === "directory"));
        setError(null);
      } catch (err) {
        setError(toAppError(err));
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((e) => !e);
  }

  const isSelected = selectedPath === path;

  return (
    <div>
      <div
        onClick={() => onSelect(path)}
        style={{ paddingLeft: depth * 14 }}
        className={clsx(
          "flex items-center gap-1 rounded py-1 pr-2 text-[12.5px] cursor-pointer",
          isSelected ? "bg-surface-selected text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
        )}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            void toggle();
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-fg-subtle hover:text-fg cursor-pointer"
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : expanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )}
        </button>
        <Folder size={13} className={clsx("shrink-0", isSelected ? "text-accent" : "text-warning")} />
        <span className="truncate">{name}</span>
      </div>
      {expanded && (
        <div>
          {error && <div className="py-1 pl-8 text-[11px] text-danger">{error.message}</div>}
          {!error && children?.length === 0 && (
            <div className="py-1 pl-8 text-[11px] text-fg-subtle">No subfolders</div>
          )}
          {children?.map((child) => (
            <DirectoryTreeNode
              key={child.path}
              path={child.path}
              name={child.name}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DirectoryTreeProps {
  rootPath: string;
  rootName?: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  className?: string;
}

/** Lazy-loading folder tree, reusable across any page that wants a
 * sidebar-style browser (Disk/Folder Analysis, Comparison, Data
 * Transfer, Sync). Only ever fetches one directory level at a time. */
export function DirectoryTree({ rootPath, rootName, selectedPath, onSelect, className }: DirectoryTreeProps) {
  return (
    <div className={clsx("overflow-y-auto", className)}>
      <DirectoryTreeNode path={rootPath} name={rootName ?? rootPath} depth={0} selectedPath={selectedPath} onSelect={onSelect} />
    </div>
  );
}

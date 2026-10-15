import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Dialog } from "@/components/dialogs/Dialog";
import { Button } from "@/components/controls/Button";
import { TextInput } from "@/components/controls/TextInput";
import { pickFile, pickFolder } from "@/api/dialog";
import { getFileMetadata, getFolderMetadata, toAppError, validatePath } from "@/api/backend";
import { useUiStore } from "@/state/uiStore";
import { formatBytes, formatDate, formatNumber } from "@/utils/format";

async function loadProperties(path: string): Promise<[string, string][]> {
  const v = await validatePath(path);
  if (!v.exists) throw new Error("That path doesn't exist.");
  const p = v.normalizedPath ?? path;
  if (v.isDirectory) {
    const m = await getFolderMetadata(p);
    return [
      ["Path", m.path],
      ["Type", "Folder"],
      ["Contains", `${formatNumber(m.directFileCount)} files (${formatBytes(m.directFileBytes)}), ${formatNumber(m.directFolderCount)} folders (directly inside)`],
      ["Created", formatDate(m.created)],
      ["Modified", formatDate(m.modified)],
      ["Accessed", formatDate(m.accessed)],
      ["Attributes", m.attributes.join(", ") || "-"],
    ];
  }
  const m = await getFileMetadata(p);
  return [
    ["Path", m.path],
    ["Type", m.extension ? `${m.extension.toUpperCase()} file` : "File"],
    ["Size", `${formatBytes(m.sizeBytes)} (${formatNumber(m.sizeBytes)} bytes)`],
    ["Size on disk", m.allocatedSizeBytes != null ? formatBytes(m.allocatedSizeBytes) : "-"],
    ["Created", formatDate(m.created)],
    ["Modified", formatDate(m.modified)],
    ["Accessed", formatDate(m.accessed)],
    ["Owner", m.owner ?? "-"],
    ["Attributes", m.attributes.join(", ") || "-"],
  ];
}

/** File or folder properties; with `initialPath` it loads straight away
 * and hides the path picker. */
export function PathProperties({ initialPath }: { initialPath?: string }) {
  const [path, setPath] = useState(initialPath ?? "");
  const [state, setState] = useState<{ path: string; rows?: [string, string][]; error?: string } | null>(null);
  const [requested, setRequested] = useState<string | null>(initialPath ?? null);

  useEffect(() => {
    if (!requested) return;
    let alive = true;
    loadProperties(requested).then(
      (rows) => alive && setState({ path: requested, rows }),
      (err) => alive && setState({ path: requested, error: err instanceof Error ? err.message : toAppError(err).message }),
    );
    return () => {
      alive = false;
    };
  }, [requested]);

  const current = state?.path === requested ? state : null;
  return (
    <div className="flex flex-col gap-3">
      {!initialPath && (
        <div className="flex gap-2">
          <TextInput value={path} onChange={(e) => setPath(e.target.value)} placeholder="A file or folder" containerClassName="flex-1" onKeyDown={(e) => e.key === "Enter" && setRequested(path.trim())} />
          <Button onClick={() => pickFile().then((p) => p && (setPath(p), setRequested(p)))}>File...</Button>
          <Button onClick={() => pickFolder().then((p) => p && (setPath(p), setRequested(p)))}>Folder...</Button>
          <Button variant="primary" disabled={!path.trim()} onClick={() => setRequested(path.trim())}>Show</Button>
        </div>
      )}
      {requested && !current && (
        <div className="flex items-center gap-2 text-[12px] text-fg-muted"><Loader2 size={14} className="animate-spin" /> Reading...</div>
      )}
      {current?.error && <p className="text-[12px] text-danger">{current.error}</p>}
      {current?.rows && (
        <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
          {current.rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-fg-muted">{k}:</dt>
              <dd className="break-all text-fg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Right-click > Properties. */
export function PropertiesDialog() {
  const { propertiesPath, closeProperties } = useUiStore();
  if (!propertiesPath) return null;
  const name = propertiesPath.split("\\").filter(Boolean).pop() ?? propertiesPath;
  return (
    <Dialog open onClose={closeProperties} title={`Properties - ${name}`} width={600} footer={<Button onClick={closeProperties}>Close</Button>}>
      <PathProperties key={propertiesPath} initialPath={propertiesPath} />
    </Dialog>
  );
}

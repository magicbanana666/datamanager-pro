import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderPlus, ImageIcon, ScanSearch, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { StatCard } from "@/components/cards/StatCard";
import { Checkbox } from "@/components/controls/Checkbox";
import { RadioGroup } from "@/components/controls/RadioGroup";
import { Select } from "@/components/controls/Select";
import { TextInput } from "@/components/controls/TextInput";
import { Button } from "@/components/controls/Button";
import { Tabs } from "@/components/controls/Tabs";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { DonutChart } from "@/components/charts/DonutChart";
import { duplicateFileTypeStats, duplicateGroups as seedGroups } from "@/mock/duplicates";
import type { DuplicateCriteriaId, DuplicateFileEntry, DuplicateGroup } from "@/models/duplicates";
import { formatBytes, formatDate, formatNumber } from "@/utils/format";
import { useSimulatedProgress } from "@/hooks/useSimulatedProgress";
import { toast } from "@/state/toastStore";
import { Copy as CopyIcon, HardDrive } from "lucide-react";

const TABS = [
  { id: "results", label: "Results" },
  { id: "summary", label: "Summary" },
  { id: "file-types", label: "File Types" },
  { id: "similar-files", label: "Similar Files" },
  { id: "folders", label: "Folders" },
  { id: "preview", label: "Preview" },
  { id: "auto-select", label: "Auto Select" },
  { id: "export", label: "Export" },
];

export function DuplicateFinderPage() {
  const [locations, setLocations] = useState([
    { path: "D:\\Data", checked: true },
    { path: "E:\\Archive", checked: true },
    { path: "C:\\Users\\jonas\\Documents", checked: false },
  ]);
  const [criteria, setCriteria] = useState<DuplicateCriteriaId>("exact");
  const [ignore, setIgnore] = useState({
    ignoreCase: true,
    ignoreTimestamps: true,
    ignoreAttributes: true,
    ignoreSystemFiles: true,
    ignoreHiddenFiles: true,
  });
  const [tab, setTab] = useState("results");
  const [groups, setGroups] = useState<DuplicateGroup[]>(seedGroups);
  const [focusedFile, setFocusedFile] = useState<DuplicateFileEntry | null>(seedGroups[0]?.files[0] ?? null);
  const [keepRule, setKeepRule] = useState("newest");

  const scan = useSimulatedProgress(() => toast.success("Duplicate scan completed."));

  const totals = useMemo(() => {
    const allFiles = groups.flatMap((g) => g.files);
    const duplicateFiles = allFiles.length;
    const totalSize = groups.reduce((s, g) => s + g.size * g.files.length, 0);
    const recoverable = groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0);
    return { duplicateFiles, totalSize, recoverable, groups: groups.length };
  }, [groups]);

  function toggleGroupExpanded(id: string) {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, expanded: !g.expanded } : g)));
  }

  function toggleFile(groupId: string, fileId: string) {
    setGroups((gs) =>
      gs.map((g) =>
        g.id !== groupId
          ? g
          : { ...g, files: g.files.map((f) => (f.id === fileId ? { ...f, selected: !f.selected } : f)) },
      ),
    );
  }

  function setGroupSelection(groupId: string, selected: boolean) {
    setGroups((gs) =>
      gs.map((g) => (g.id !== groupId ? g : { ...g, files: g.files.map((f) => (f.isOriginal ? f : { ...f, selected })) })),
    );
  }

  const focusedGroup = groups.find((g) => g.files.some((f) => f.id === focusedFile?.id)) ?? null;
  const selectedCount = groups.reduce((s, g) => s + g.files.filter((f) => f.selected).length, 0);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Duplicate Finder" description="Find and safely review duplicate files across multiple locations." />

      <div className="flex items-stretch gap-3">
        <Card title="Select Location(s)" className="flex-1">
          <div className="flex flex-col gap-1.5">
            {locations.map((loc, i) => (
              <Checkbox
                key={loc.path}
                checked={loc.checked}
                onChange={(v) =>
                  setLocations((ls) => ls.map((l, idx) => (idx === i ? { ...l, checked: v } : l)))
                }
                label={loc.path}
              />
            ))}
            <Button size="sm" icon={FolderPlus} className="mt-1 self-start" onClick={() => toast.demo()}>
              Add Folder...
            </Button>
          </div>
        </Card>

        <Card title="Duplicate Criteria" className="w-[280px] shrink-0">
          <RadioGroup
            name="criteria"
            value={criteria}
            onChange={setCriteria}
            options={[
              { value: "exact", label: "Exact match (same content)" },
              { value: "same-name", label: "Same file name" },
              { value: "same-size", label: "Same file size" },
              { value: "similar-content", label: "Similar content / hash" },
            ]}
          />
        </Card>

        <Card title="Options" className="w-[220px] shrink-0">
          <div className="flex flex-col gap-1.5">
            <Checkbox checked={ignore.ignoreCase} onChange={(v) => setIgnore((o) => ({ ...o, ignoreCase: v }))} label="Ignore file name case" />
            <Checkbox checked={ignore.ignoreTimestamps} onChange={(v) => setIgnore((o) => ({ ...o, ignoreTimestamps: v }))} label="Ignore timestamps" />
            <Checkbox checked={ignore.ignoreAttributes} onChange={(v) => setIgnore((o) => ({ ...o, ignoreAttributes: v }))} label="Ignore file attributes" />
            <Checkbox checked={ignore.ignoreSystemFiles} onChange={(v) => setIgnore((o) => ({ ...o, ignoreSystemFiles: v }))} label="Ignore system files" />
            <Checkbox checked={ignore.ignoreHiddenFiles} onChange={(v) => setIgnore((o) => ({ ...o, ignoreHiddenFiles: v }))} label="Ignore hidden files" />
          </div>
        </Card>

        <Card title="File Types" className="w-[220px] shrink-0">
          <div className="flex flex-col gap-2">
            <Select options={[{ value: "all", label: "All files (*.*)" }]} />
            <div className="flex items-center gap-1.5 text-[12px] text-fg-muted">
              Min <TextInput placeholder="1" containerClassName="w-16" /> MB
            </div>
          </div>
        </Card>

        <div className="flex w-[150px] shrink-0 flex-col justify-center gap-2">
          <Button variant="primary" icon={ScanSearch} onClick={() => scan.start(3)} disabled={scan.status === "running"}>
            {scan.status === "running" ? `${scan.progress.toFixed(0)}%` : "Start Scan"}
          </Button>
          {scan.status === "running" && <ProgressBar value={scan.progress} />}
        </div>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={CopyIcon} label="Duplicate Files" value={formatNumber(totals.duplicateFiles)} sublabel={`${totals.groups} groups`} tone="warning" />
        <StatCard icon={HardDrive} label="Total Duplicate Size" value={formatBytes(totals.totalSize)} tone="accent" />
        <StatCard icon={Trash2} label="Space Recoverable" value={formatBytes(totals.recoverable)} tone="success" />
        <StatCard icon={ScanSearch} label="Duplicate Groups" value={String(totals.groups)} sublabel={`Selected: ${selectedCount} files`} tone="info" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px] gap-3">
        <Card padded={false} bodyClassName="min-h-0" className="min-h-0 overflow-y-auto">
          {tab === "results" ? (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface-alt">
                <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                  <th className="w-8 py-2" />
                  <th className="py-2">Name / Group</th>
                  <th className="py-2">Path</th>
                  <th className="py-2 text-right">Size</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Modified</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.id}>
                    <tr
                      key={g.id}
                      onClick={() => toggleGroupExpanded(g.id)}
                      className="cursor-pointer border-b border-border/60 bg-surface-alt/60 hover:bg-surface-hover"
                    >
                      <td className="py-2 pl-2.5 text-fg-muted">
                        {g.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </td>
                      <td className="py-2 font-semibold text-fg" colSpan={2}>
                        Group: {g.label} ({g.files.length} files)
                      </td>
                      <td className="py-2 text-right text-fg-muted">{formatBytes(g.size)}</td>
                      <td className="py-2 text-fg-muted">{g.type}</td>
                      <td className="py-2 text-fg-muted">{g.files.length} dup.</td>
                    </tr>
                    {g.expanded &&
                      g.files.map((f) => (
                        <tr
                          key={f.id}
                          onClick={() => setFocusedFile(f)}
                          className={
                            "cursor-pointer border-b border-border/40 " +
                            (focusedFile?.id === f.id ? "bg-surface-selected" : "hover:bg-surface-hover")
                          }
                        >
                          <td className="py-1.5 pl-4">
                            <Checkbox checked={f.selected} onChange={() => toggleFile(g.id, f.id)} disabled={f.isOriginal} />
                          </td>
                          <td className="py-1.5 pl-2 text-fg">
                            {f.name} {f.isOriginal && <span className="ml-1 text-[10px] text-success">(original)</span>}
                          </td>
                          <td className="py-1.5 text-fg-muted">{f.path}</td>
                          <td className="py-1.5 text-right text-fg-muted">{formatBytes(f.size)}</td>
                          <td className="py-1.5 text-fg-muted">{f.type}</td>
                          <td className="py-1.5 text-fg-muted">{formatDate(f.modified)}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          ) : tab === "summary" ? (
            <div className="flex flex-col gap-2 p-3 text-[12.5px] text-fg-muted">
              <p>{totals.duplicateFiles} duplicate files across {totals.groups} groups.</p>
              <p>Total duplicate size: {formatBytes(totals.totalSize)}. Space recoverable if cleaned: {formatBytes(totals.recoverable)}.</p>
            </div>
          ) : tab === "file-types" ? (
            <div className="flex h-full items-center justify-center">
              <DonutChart data={duplicateFileTypeStats} centerLabel="Total Size" centerValue={formatBytes(totals.totalSize)} size={200} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
              Sample "{TABS.find((t) => t.id === tab)?.label}" view - Phase 1 preview.
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-3 overflow-y-auto">
          <Card title="Preview" bodyClassName="flex flex-col items-center gap-2 p-3">
            <div className="flex h-24 w-24 items-center justify-center rounded-md border border-border-strong bg-surface-alt">
              <ImageIcon size={28} className="text-fg-subtle" />
            </div>
            <div className="text-center text-[12px] text-fg-muted">{focusedFile?.name ?? "No file selected"}</div>
          </Card>
          <Card title="File Details" bodyClassName="flex flex-col gap-1.5 p-3 text-[12.5px]">
            {focusedFile ? (
              <dl className="grid grid-cols-[60px_1fr] gap-y-1">
                <dt className="text-fg-muted">Path:</dt>
                <dd className="truncate text-fg">{focusedFile.path}</dd>
                <dt className="text-fg-muted">Size:</dt>
                <dd className="text-fg">{formatBytes(focusedFile.size)}</dd>
                <dt className="text-fg-muted">Type:</dt>
                <dd className="text-fg">{focusedFile.type}</dd>
                <dt className="text-fg-muted">Modified:</dt>
                <dd className="text-fg">{formatDate(focusedFile.modified)}</dd>
              </dl>
            ) : (
              <p className="text-fg-subtle">Select a file to see details.</p>
            )}
          </Card>
          <Card title="Group Selection" bodyClassName="flex flex-col gap-1.5 p-3">
            <Button size="sm" disabled={!focusedGroup} onClick={() => focusedGroup && setGroupSelection(focusedGroup.id, true)}>
              Select All in Group
            </Button>
            <Button size="sm" disabled={!focusedGroup} onClick={() => focusedGroup && setGroupSelection(focusedGroup.id, false)}>
              Deselect All
            </Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => toast.demoNoFilesModified()}>
              Delete Selected Files
            </Button>
            <Button size="sm" onClick={() => toast.demo()}>Move to Folder...</Button>
          </Card>
          <Card title="Keep Rules (Auto Select)" bodyClassName="flex flex-col gap-2 p-3">
            <Select
              value={keepRule}
              onChange={(e) => setKeepRule(e.target.value)}
              options={[
                { value: "newest", label: "Keep newest file" },
                { value: "oldest", label: "Keep oldest file" },
                { value: "shortest-path", label: "Keep shortest path" },
                { value: "largest", label: "Keep largest file" },
              ]}
            />
            <Button size="sm" onClick={() => toast.demo()}>Apply Rule to All Groups</Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

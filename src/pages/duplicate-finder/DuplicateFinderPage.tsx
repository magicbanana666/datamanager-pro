import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FolderPlus, ImageIcon, ScanSearch, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { StatCard } from "@/components/cards/StatCard";
import { Checkbox } from "@/components/controls/Checkbox";
import { RadioGroup } from "@/components/controls/RadioGroup";
import { Select } from "@/components/controls/Select";
import { TextInput } from "@/components/controls/TextInput";
import { Button } from "@/components/controls/Button";
import { Tabs } from "@/components/controls/Tabs";
import { DemoBadge } from "@/components/controls/DemoBadge";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { DonutChart } from "@/components/charts/DonutChart";
import { duplicateFileTypeStats, duplicateGroups as seedGroups } from "@/mock/duplicates";
import type { DuplicateCriteriaId, DuplicateFileEntry, DuplicateGroup, HashJobProgress } from "@/models/duplicates";
import { pickFolder } from "@/api/dialog";
import { useDuplicateStore } from "@/state/duplicateStore";
import { toast } from "@/state/toastStore";
import {
  applyKeepRule,
  duplicateCategoryStats,
  duplicateFolderStats,
  toUiGroups,
  type KeepRule,
} from "@/utils/duplicates";
import { formatBytes, formatDate, formatNumber } from "@/utils/format";
import { Copy as CopyIcon, HardDrive } from "lucide-react";

const TABS = [
  { id: "results", label: "Results" },
  { id: "summary", label: "Summary" },
  { id: "file-types", label: "File Types" },
  { id: "folders", label: "Folders" },
  { id: "preview", label: "Preview" },
  { id: "export", label: "Export" },
];

const MB = 1024 * 1024;

const PHASE_LABELS: Record<HashJobProgress["phase"], string> = {
  collecting: "Listing files",
  comparing: "Comparing",
  hashing: "Hashing",
};

/** 0-100 for the hashing phases; `null` while listing files, which has
 * no known total to measure against. */
function progressPercent(p: HashJobProgress | null): number | null {
  if (!p || p.phase === "collecting" || p.bytesToHash === 0) return null;
  return Math.min(100, (p.bytesHashed / p.bytesToHash) * 100);
}

function parseMb(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return value.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * MB) : null;
}

export function DuplicateFinderPage() {
  const [locations, setLocations] = useState<{ path: string; checked: boolean }[]>([]);
  const [criteria, setCriteria] = useState<DuplicateCriteriaId>("exact");
  const [ignore, setIgnore] = useState({ ignoreCase: true, ignoreHidden: true, ignoreSystem: true });
  const [minMb, setMinMb] = useState("1");
  const [maxMb, setMaxMb] = useState("");
  const [tab, setTab] = useState("results");
  const [keepRule, setKeepRule] = useState<KeepRule>("newest");
  const run = useDuplicateStore();
  const isReal = run.status === "completed" && !!run.result;

  // The groups are local state on top of the (immutable) result, since
  // expanding/selecting edits them. Rebuilt whenever a new result
  // arrives - during render, the same "adjust state when a prop
  // changes" pattern DiskAnalysisPage uses.
  const [groups, setGroups] = useState<DuplicateGroup[]>(() =>
    run.result ? toUiGroups(run.result, keepRule) : seedGroups,
  );
  const [lastSeenResult, setLastSeenResult] = useState(run.result);
  if (run.result !== lastSeenResult) {
    setLastSeenResult(run.result);
    if (run.result) setGroups(toUiGroups(run.result, keepRule));
  }
  const [focusedFile, setFocusedFile] = useState<DuplicateFileEntry | null>(null);

  const totals = useMemo(() => {
    if (isReal && run.result) {
      return {
        duplicateFiles: run.result.totalDuplicateFiles,
        groups: run.result.totalGroups,
        recoverable: run.result.totalWastedBytes,
        totalSize: groups.reduce((s, g) => s + g.files.reduce((a, f) => a + f.size, 0), 0),
      };
    }
    return {
      duplicateFiles: groups.reduce((s, g) => s + g.files.length, 0),
      groups: groups.length,
      recoverable: groups.reduce((s, g) => s + g.wastedBytes, 0),
      totalSize: groups.reduce((s, g) => s + g.size * g.files.length, 0),
    };
  }, [groups, isReal, run.result]);

  const categoryStats = useMemo(() => (isReal ? duplicateCategoryStats(groups) : duplicateFileTypeStats), [groups, isReal]);
  const folderStats = useMemo(() => duplicateFolderStats(groups), [groups]);

  async function addLocation() {
    const path = await pickFolder();
    if (!path) return;
    setLocations((ls) => (ls.some((l) => l.path === path) ? ls : [...ls, { path, checked: true }]));
  }

  function startScan() {
    const roots = locations.filter((l) => l.checked).map((l) => l.path);
    if (roots.length === 0) {
      toast.warning("Add and tick at least one location first.");
      return;
    }
    void run.start(roots, {
      criteria,
      ignoreCase: ignore.ignoreCase,
      ignoreHidden: ignore.ignoreHidden,
      ignoreSystem: ignore.ignoreSystem,
      minSize: parseMb(minMb) ?? 0,
      maxSize: parseMb(maxMb),
    });
  }

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
  const selectedFiles = groups.flatMap((g) => g.files.filter((f) => f.selected));
  const selectedBytes = selectedFiles.reduce((s, f) => s + f.size, 0);
  const running = run.status === "running";
  const percent = progressPercent(run.progress);
  const shownGroups = isReal && run.result ? run.result.groups.length : groups.length;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="Duplicate Finder" description="Find and safely review duplicate files across multiple locations." />

      <div className="flex items-stretch gap-3">
        <Card title="Select Location(s)" className="flex-1">
          <div className="flex flex-col gap-1.5">
            {locations.length === 0 && (
              <p className="text-[12px] text-fg-subtle">No locations yet - add one or more folders to search.</p>
            )}
            {locations.map((loc, i) => (
              <div key={loc.path} className="flex min-w-0 items-center gap-1">
                <Checkbox
                  checked={loc.checked}
                  onChange={(v) => setLocations((ls) => ls.map((l, idx) => (idx === i ? { ...l, checked: v } : l)))}
                  label={loc.path}
                />
                <button
                  onClick={() => setLocations((ls) => ls.filter((_, idx) => idx !== i))}
                  className="ml-auto shrink-0 text-fg-subtle hover:text-fg"
                  title="Remove location"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <Button size="sm" icon={FolderPlus} className="mt-1 self-start" onClick={() => void addLocation()} disabled={running}>
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
            ]}
          />
        </Card>

        <Card title="Options" className="w-[220px] shrink-0">
          <div className="flex flex-col gap-1.5">
            <Checkbox
              checked={ignore.ignoreCase}
              onChange={(v) => setIgnore((o) => ({ ...o, ignoreCase: v }))}
              label="Ignore file name case"
              disabled={criteria !== "same-name"}
            />
            <Checkbox checked={ignore.ignoreSystem} onChange={(v) => setIgnore((o) => ({ ...o, ignoreSystem: v }))} label="Ignore system files" />
            <Checkbox checked={ignore.ignoreHidden} onChange={(v) => setIgnore((o) => ({ ...o, ignoreHidden: v }))} label="Ignore hidden files" />
          </div>
        </Card>

        <Card title="File Size" className="w-[200px] shrink-0">
          <div className="flex flex-col gap-2 text-[12px] text-fg-muted">
            <div className="flex items-center gap-1.5">
              <span className="w-7">Min</span>
              <TextInput value={minMb} onChange={(e) => setMinMb(e.target.value)} placeholder="0" containerClassName="w-20" /> MB
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-7">Max</span>
              <TextInput value={maxMb} onChange={(e) => setMaxMb(e.target.value)} placeholder="none" containerClassName="w-20" /> MB
            </div>
          </div>
        </Card>

        <div className="flex w-[170px] shrink-0 flex-col justify-center gap-2">
          {running ? (
            <Button icon={X} onClick={() => void run.cancel()}>
              Cancel
            </Button>
          ) : (
            <Button variant="primary" icon={ScanSearch} onClick={startScan}>
              Start Scan
            </Button>
          )}
          {running && (
            <>
              {percent !== null && <ProgressBar value={percent} />}
              <span className="truncate text-[11px] text-fg-muted" title={run.progress?.currentPath}>
                {run.progress
                  ? `${PHASE_LABELS[run.progress.phase]}${percent !== null ? ` ${percent.toFixed(0)}%` : ` - ${formatNumber(run.progress.filesFound)} files`}`
                  : "Starting..."}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        {!isReal && <DemoBadge />}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={CopyIcon} label="Duplicate Files" value={formatNumber(totals.duplicateFiles)} sublabel={`${formatNumber(totals.groups)} groups`} tone="warning" />
        <StatCard icon={HardDrive} label="Total Duplicate Size" value={formatBytes(totals.totalSize)} sublabel={isReal ? "in the groups shown" : undefined} tone="accent" />
        <StatCard icon={Trash2} label="Space Recoverable" value={formatBytes(totals.recoverable)} tone="success" />
        <StatCard
          icon={ScanSearch}
          label="Duplicate Groups"
          value={formatNumber(totals.groups)}
          sublabel={`Selected: ${formatNumber(selectedFiles.length)} files (${formatBytes(selectedBytes)})`}
          tone="info"
        />
      </div>

      {/* auto-rows-fr: see the identical comment in DiskAnalysisPage.tsx -
          same shared layout bug (this page doesn't use Treemap, but the
          fix is the same generally-correct "actually fill available
          height" behavior either way). */}
      <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-[1fr_300px] gap-3">
        <Card padded={false} bodyClassName="min-h-0" className="min-h-0 overflow-y-auto">
          {tab === "results" ? (
            groups.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
                No duplicates found among {formatNumber(run.result?.filesCompared ?? 0)} files.
              </div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-surface-alt">
                  <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                    <th className="w-8 py-2 pl-2.5" />
                    <th className="px-3 py-2">Name / Group</th>
                    <th className="px-3 py-2">Path</th>
                    <th className="px-3 py-2 text-right">Size</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.id}>
                      <tr
                        onClick={() => toggleGroupExpanded(g.id)}
                        className="cursor-pointer border-b border-border/60 bg-surface-alt/60 hover:bg-surface-hover"
                      >
                        <td className="py-2 pl-2.5 text-fg-muted">
                          {g.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </td>
                        <td className="px-3 py-2 font-semibold text-fg" colSpan={2}>
                          Group: {g.label} ({g.files.length} files)
                        </td>
                        <td className="px-3 py-2 text-right text-fg-muted">{formatBytes(g.size)}</td>
                        <td className="px-3 py-2 text-fg-muted">{g.type}</td>
                        <td className="px-3 py-2 text-fg-muted">{formatBytes(g.wastedBytes)} recoverable</td>
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
                            <td className="py-1.5 pl-4" onClick={(e) => e.stopPropagation()}>
                              <Checkbox checked={f.selected} onChange={() => toggleFile(g.id, f.id)} disabled={f.isOriginal} />
                            </td>
                            <td className="px-3 py-1.5 text-fg">
                              {f.name} {f.isOriginal && <span className="ml-1 text-[10px] text-success">(keep)</span>}
                            </td>
                            <td className="max-w-[420px] truncate px-3 py-1.5 text-fg-muted" title={f.path}>
                              {f.path}
                            </td>
                            <td className="px-3 py-1.5 text-right text-fg-muted">{formatBytes(f.size)}</td>
                            <td className="px-3 py-1.5 text-fg-muted">{f.type}</td>
                            <td className="px-3 py-1.5 text-fg-muted">{formatDate(f.modified)}</td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )
          ) : tab === "summary" ? (
            <div className="flex flex-col gap-2 p-3 text-[12.5px] text-fg-muted">
              <p>
                {formatNumber(totals.duplicateFiles)} duplicate files across {formatNumber(totals.groups)} groups. Space recoverable if
                cleaned: {formatBytes(totals.recoverable)}.
              </p>
              {isReal && run.result && (
                <>
                  <p>
                    Compared {formatNumber(run.result.filesCompared)} files in {(run.result.elapsedMs / 1000).toFixed(1)} s.
                  </p>
                  {run.result.totalGroups > shownGroups && (
                    <p>
                      Showing the {formatNumber(shownGroups)} groups with the most recoverable space; the totals above cover all{" "}
                      {formatNumber(run.result.totalGroups)}.
                    </p>
                  )}
                  {run.result.skipped.length > 0 && (
                    <p>{formatNumber(run.result.skipped.length)} files or folders couldn't be read (in use or access denied) and were skipped.</p>
                  )}
                  <p>Hard links (several paths to the same physical file) are never reported as duplicates.</p>
                </>
              )}
            </div>
          ) : tab === "file-types" ? (
            <div className="flex h-full items-center justify-center">
              <DonutChart data={categoryStats} centerLabel="Recoverable" centerValue={formatBytes(totals.recoverable)} size={200} />
            </div>
          ) : tab === "folders" ? (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface-alt">
                <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                  <th className="px-3 py-2">Folder</th>
                  <th className="px-3 py-2 text-right">Duplicate files</th>
                  <th className="px-3 py-2 text-right">Size</th>
                </tr>
              </thead>
              <tbody>
                {folderStats.map((f) => (
                  <tr key={f.path} className="border-b border-border/40">
                    <td className="max-w-[520px] truncate px-3 py-1.5 text-fg" title={f.path}>
                      {f.path}
                    </td>
                    <td className="px-3 py-1.5 text-right text-fg-muted">{formatNumber(f.files)}</td>
                    <td className="px-3 py-1.5 text-right text-fg-muted">{formatBytes(f.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-fg-subtle">
              Sample "{TABS.find((t) => t.id === tab)?.label}" view - Phase 1 preview.
            </div>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-3 overflow-y-auto">
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
                <dd className="truncate text-fg" title={focusedFile.path}>
                  {focusedFile.path}
                </dd>
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
            {/* Deleting/moving files is Phase 6 (the copy/move engine) -
                this phase is strictly read-only. */}
            <Button size="sm" variant="danger" icon={Trash2} onClick={() => toast.demoNoFilesModified()}>
              Delete Selected Files
            </Button>
            <Button size="sm" onClick={() => toast.demo()}>Move to Folder...</Button>
          </Card>
          <Card title="Keep Rules (Auto Select)" bodyClassName="flex flex-col gap-2 p-3">
            <Select
              value={keepRule}
              onChange={(e) => setKeepRule(e.target.value as KeepRule)}
              options={[
                { value: "newest", label: "Keep newest file" },
                { value: "oldest", label: "Keep oldest file" },
                { value: "shortest-path", label: "Keep shortest path" },
                { value: "largest", label: "Keep largest file" },
              ]}
            />
            <Button size="sm" onClick={() => setGroups((gs) => applyKeepRule(gs, keepRule))}>
              Apply Rule to All Groups
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

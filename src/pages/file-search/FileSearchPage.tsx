import { useEffect, useMemo, useState } from "react";
import { Copy, File, FileText, FolderOpen, Search, X } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { TextInput } from "@/components/controls/TextInput";
import { Select } from "@/components/controls/Select";
import { Button } from "@/components/controls/Button";
import { Checkbox } from "@/components/controls/Checkbox";
import { Tabs } from "@/components/controls/Tabs";
import { Badge } from "@/components/controls/Badge";
import { DonutChart } from "@/components/charts/DonutChart";
import { BarChartPanel } from "@/components/charts/BarChartPanel";
import { ProgressBar } from "@/components/charts/ProgressBar";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { HighlightText } from "@/components/controls/HighlightText";
import { getTextPreview, openPath } from "@/api/search";
import { toAppError } from "@/api/backend";
import { Dialog } from "@/components/dialogs/Dialog";
import { useSavedSearchStore, type SavedSearch } from "@/state/savedSearchStore";
import { FILE_TYPE_CATEGORIES } from "@/models/common";
import type { SearchResultRow } from "@/models/search";
import { useSearchStore } from "@/state/searchStore";
import { toast } from "@/state/toastStore";
import {
  categoryExtensions,
  hitCategoryStats,
  hitFolders,
  hitTimeline,
  modifiedAfter,
  toRows,
  type ModifiedRange,
} from "@/utils/search";
import { formatBytes, formatDate, formatNumber } from "@/utils/format";

const DETAIL_TABS = [
  { id: "preview", label: "Preview" },
  { id: "details", label: "Details" },
  { id: "occurrences", label: "Occurrences" },
];

const MATCH_BADGE = {
  name: { tone: "info", label: "Name" },
  content: { tone: "success", label: "Content" },
  archive: { tone: "warning", label: "In .zip" },
} as const;

const MB = 1024 * 1024;

function parseMb(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return value.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * MB) : null;
}

export function FileSearchPage() {
  const run = useSearchStore();
  const [location, setLocation] = useState(() => useSearchStore.getState().args?.[0] ?? "");
  const [term, setTerm] = useState(() => useSearchStore.getState().args?.[1].query ?? "");
  const [options, setOptions] = useState({
    fileName: true,
    fileContent: false,
    caseSensitive: false,
    regex: false,
    includeSubfolders: true,
    compressedArchives: false,
    wholeWords: false,
    includeBinary: false,
    includeHidden: false,
    includeSystem: false,
  });
  const [category, setCategory] = useState("all");
  const [minMb, setMinMb] = useState("");
  const [maxMb, setMaxMb] = useState("");
  const [range, setRange] = useState<ModifiedRange>("any");
  const [resultTab, setResultTab] = useState("results");
  const [detailTab, setDetailTab] = useState("preview");
  const [selected, setSelected] = useState<SearchResultRow | null>(null);
  const [preview, setPreview] = useState<{ path: string; text: string | null } | null>(null);
  const saved = useSavedSearchStore();
  const [savedName, setSavedName] = useState("");
  const [saveDialog, setSaveDialog] = useState(false);
  const [manageDialog, setManageDialog] = useState(false);

  function applySaved(name: string) {
    const s = saved.searches.find((x) => x.name === name);
    if (!s) return;
    setSavedName(name);
    setLocation(s.location);
    setTerm(s.term);
    setOptions((o) => ({ ...o, ...s.options }));
    setCategory(s.category);
    setMinMb(s.minMb);
    setMaxMb(s.maxMb);
    setRange(s.range);
  }

  function saveCurrent() {
    const name = savedName.trim();
    if (!name) return;
    const search: SavedSearch = { name, location, term, options, category, minMb, maxMb, range };
    saved.save(search);
    setSaveDialog(false);
    toast.success(`Saved search "${name}".`);
  }

  const isReal = run.status === "completed" && !!run.result;
  const running = run.status === "running";
  const rows = useMemo(() => (isReal && run.result ? toRows(run.result.hits) : []), [isReal, run.result]);
  const totalHits = isReal && run.result ? run.result.totalHits : rows.length;
  // Highlighting only makes sense for a plain-text query - a regex or
  // wildcard pattern isn't the literal text to mark.
  const highlightTerm = options.regex || /[*?]/.test(term) ? "" : (run.result ? term : "");

  const categoryStats = useMemo(() => hitCategoryStats(rows), [rows]);
  const folders = useMemo(() => hitFolders(rows), [rows]);
  const timeline = useMemo(() => hitTimeline(rows), [rows]);

  const resultTabs = [
    { id: "results", label: "Results", badge: totalHits },
    { id: "file-types", label: "File Types" },
    { id: "folders", label: "Folders" },
    { id: "timeline", label: "Timeline" },
  ];

  // The Preview tab reads the start of the selected (real) file.
  const previewPath = isReal && detailTab === "preview" ? selected?.hit?.path : undefined;
  useEffect(() => {
    if (!previewPath) return;
    let cancelled = false;
    getTextPreview(previewPath).then(
      (text) => !cancelled && setPreview({ path: previewPath, text }),
      () => !cancelled && setPreview({ path: previewPath, text: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [previewPath]);
  const previewText = preview && preview.path === previewPath ? preview.text : undefined;

  function startSearch() {
    setSelected(null);
    void run.start(location, {
      query: term,
      matchName: options.fileName,
      matchContent: options.fileContent,
      caseSensitive: options.caseSensitive,
      regex: options.regex,
      wholeWords: options.wholeWords,
      includeSubfolders: options.includeSubfolders,
      searchArchives: options.compressedArchives,
      includeBinary: options.includeBinary,
      includeHidden: options.includeHidden,
      includeSystem: options.includeSystem,
      extensions: categoryExtensions(category),
      minSize: parseMb(minMb),
      maxSize: parseMb(maxMb),
      modifiedAfter: modifiedAfter(range),
    });
  }

  async function runAction(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      toast.danger(toAppError(err).message);
    }
  }

  const progress = run.progress;
  const percent =
    progress && progress.phase !== "collecting" && progress.bytesToHash > 0
      ? Math.min(100, (progress.bytesHashed / progress.bytesToHash) * 100)
      : null;

  const columns: DataTableColumn<SearchResultRow>[] = [
    {
      key: "name",
      header: "Name",
      width: 260,
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="flex items-center gap-1.5 truncate" title={r.name}>
          <File size={13} className="shrink-0 text-fg-subtle" />
          <HighlightText text={r.name} term={highlightTerm} />
        </span>
      ),
    },
    { key: "path", header: "Path", width: 260, sortAccessor: (r) => r.path, render: (r) => <span className="truncate text-fg-muted" title={r.path}>{r.path}</span> },
    { key: "size", header: "Size", width: 90, align: "right", sortAccessor: (r) => r.size, render: (r) => formatBytes(r.size) },
    { key: "type", header: "Type", width: 110, sortAccessor: (r) => r.type, render: (r) => <span className="text-fg-muted">{r.type}</span> },
    { key: "modified", header: "Modified", width: 140, sortAccessor: (r) => r.modified, render: (r) => formatDate(r.modified) },
    {
      key: "match",
      header: "Match",
      width: 110,
      sortAccessor: (r) => r.occurrences ?? 0,
      render: (r) => {
        if (!r.hit) return null;
        const b = MATCH_BADGE[r.hit.matchedIn];
        return (
          <span className="flex items-center gap-1.5">
            <Badge tone={b.tone}>{b.label}</Badge>
            {r.hit.occurrences > 0 && <span className="text-fg-muted">×{formatNumber(r.hit.occurrences)}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="File Search" description="Find files by name or content across local and network locations." />

      <div className="flex items-stretch gap-3">
        <Card title="Search Location" className="flex-1">
          <div className="flex flex-col gap-2">
            <LocationPicker value={location} onChange={setLocation} />
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
              <Checkbox checked={options.includeSubfolders} onChange={(v) => setOptions((o) => ({ ...o, includeSubfolders: v }))} label="Include subfolders" />
              <Checkbox checked={options.compressedArchives} onChange={(v) => setOptions((o) => ({ ...o, compressedArchives: v }))} label="Search inside .zip archives (names)" />
            </div>
          </div>
        </Card>
        <Card title="Search Criteria" className="flex-1">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <TextInput
                icon={Search}
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !running && startSearch()}
                placeholder="Name, *.pdf, or text to find..."
                containerClassName="flex-1"
              />
              {running ? (
                <Button icon={X} onClick={() => void run.cancel()}>
                  Cancel
                </Button>
              ) : (
                <Button variant="primary" icon={Search} onClick={startSearch}>
                  Search
                </Button>
              )}
              <Button icon={X} onClick={() => setTerm("")} disabled={running}>
                Clear
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <Checkbox checked={options.fileName} onChange={(v) => setOptions((o) => ({ ...o, fileName: v }))} label="File name" />
              <Checkbox checked={options.fileContent} onChange={(v) => setOptions((o) => ({ ...o, fileContent: v }))} label="File content" />
              <Checkbox checked={options.caseSensitive} onChange={(v) => setOptions((o) => ({ ...o, caseSensitive: v }))} label="Case sensitive" />
              <Checkbox checked={options.regex} onChange={(v) => setOptions((o) => ({ ...o, regex: v }))} label="Regex" />
            </div>
            {running && (
              <div className="flex items-center gap-2">
                {percent !== null && <ProgressBar value={percent} className="flex-1" />}
                <span className="truncate text-[11px] text-fg-muted" title={progress?.currentPath}>
                  {progress
                    ? progress.phase === "collecting"
                      ? `Listing files - ${formatNumber(progress.filesFound)} found`
                      : `Searching content ${percent?.toFixed(0) ?? 0}%`
                    : "Starting..."}
                </span>
              </div>
            )}
          </div>
        </Card>
        <Card title="Saved Searches" className="w-[220px] shrink-0">
          <div className="flex flex-col gap-2">
            <Select
              value={saved.searches.some((s) => s.name === savedName) ? savedName : ""}
              onChange={(e) => applySaved(e.target.value)}
              options={[
                { value: "", label: saved.searches.length ? "Choose a saved search..." : "No saved searches yet" },
                ...saved.searches.map((s) => ({ value: s.name, label: s.name })),
              ]}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setSaveDialog(true)}>Save</Button>
              <Button size="sm" disabled={saved.searches.length === 0} onClick={() => setManageDialog(true)}>Manage...</Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[210px_1fr_300px] gap-3">
        <Card title="Filters" bodyClassName="flex flex-col gap-3 p-3" className="min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">File Types</label>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={[{ value: "all", label: "All files (*.*)" }, ...FILE_TYPE_CATEGORIES.filter((c) => c.extensions.length > 0).map((c) => ({ value: c.id, label: c.label }))]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Size (MB)</label>
            <div className="flex items-center gap-1.5">
              <TextInput value={minMb} onChange={(e) => setMinMb(e.target.value)} placeholder="Min" containerClassName="flex-1" />
              <span className="text-fg-subtle">-</span>
              <TextInput value={maxMb} onChange={(e) => setMaxMb(e.target.value)} placeholder="Max" containerClassName="flex-1" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Modified Date</label>
            <Select
              value={range}
              onChange={(e) => setRange(e.target.value as ModifiedRange)}
              options={[
                { value: "any", label: "Any time" },
                { value: "today", label: "Today" },
                { value: "week", label: "This week" },
                { value: "month", label: "This month" },
                { value: "year", label: "This year" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Include</label>
            <Checkbox checked={options.includeHidden} onChange={(v) => setOptions((o) => ({ ...o, includeHidden: v }))} label="Hidden files" />
            <Checkbox checked={options.includeSystem} onChange={(v) => setOptions((o) => ({ ...o, includeSystem: v }))} label="System files" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Content Options</label>
            <Checkbox checked={options.wholeWords} onChange={(v) => setOptions((o) => ({ ...o, wholeWords: v }))} label="Match whole words" />
            <Checkbox
              checked={options.includeBinary}
              onChange={(v) => setOptions((o) => ({ ...o, includeBinary: v }))}
              label="Include binary files"
              disabled={!options.fileContent}
            />
          </div>
          <p className="text-[11px] leading-snug text-fg-subtle">
            Content search reads plain-text files (UTF-8/ASCII) up to 64 MB. Text inside .docx/.pdf or UTF-16 files isn't searched.
          </p>
        </Card>

        <Card padded={false} bodyClassName="flex flex-col gap-2 p-3 min-h-0" className="min-h-0">
          <div className="flex items-center justify-between gap-3">
            <Tabs tabs={resultTabs} active={resultTab} onChange={setResultTab} className="min-w-0 flex-1" />
            {isReal && run.result && run.result.totalHits > rows.length && (
              <span className="shrink-0 text-[11px] text-fg-subtle">First {formatNumber(rows.length)} shown</span>
            )}
          </div>
          {resultTab === "results" && (
            <DataTable
              columns={columns}
              rows={rows}
              getRowId={(r) => r.id}
              selectedId={selected?.id ?? null}
              onRowClick={setSelected}
              onRowDoubleClick={(r) => r.hit && void runAction(() => openPath(r.hit!.path))}
              emptyMessage={
                running
                  ? "Searching..."
                  : run.result
                    ? `No matches among ${formatNumber(run.result.filesSearched)} files.`
                    : "Choose a location and search for a name, pattern or text."
              }
              className="flex-1"
            />
          )}
          {resultTab === "file-types" && (
            <div className="flex flex-1 items-center justify-center">
              <DonutChart data={categoryStats} centerLabel="Matches" centerValue={formatNumber(totalHits)} size={200} />
            </div>
          )}
          {resultTab === "folders" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-surface-alt">
                  <tr className="border-b border-border text-left text-[11px] font-semibold text-fg-muted">
                    <th className="px-3 py-2">Folder</th>
                    <th className="px-3 py-2 text-right">Matches</th>
                    <th className="px-3 py-2 text-right">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {folders.map((f) => (
                    <tr key={f.path} className="border-b border-border/40">
                      <td className="max-w-[420px] truncate px-3 py-1.5 text-fg" title={f.path}>
                        {f.path}
                      </td>
                      <td className="px-3 py-1.5 text-right text-fg-muted">{formatNumber(f.matches)}</td>
                      <td className="px-3 py-1.5 text-right text-fg-muted">{formatBytes(f.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {resultTab === "timeline" && (
            <BarChartPanel
              data={timeline}
              categoryKey="label"
              series={[{ key: "matches", label: "Matches", color: "var(--color-chart-1)" }]}
              valueFormatter={(v) => formatNumber(v)}
              height={260}
            />
          )}
        </Card>

        <Card padded={false} bodyClassName="flex flex-col gap-3 p-3 min-h-0" className="min-h-0 overflow-y-auto">
          <Tabs tabs={DETAIL_TABS} active={detailTab} onChange={setDetailTab} />
          {selected ? (
            <>
              {detailTab === "preview" &&
                (selected.hit ? (
                  previewText === undefined ? (
                    <p className="text-xs text-fg-subtle">Loading preview...</p>
                  ) : previewText === null ? (
                    <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-canvas-alt p-4">
                      <FileText size={40} className="text-fg-subtle" />
                      <div className="text-center text-[12px] text-fg-muted">No text preview for this file type.</div>
                    </div>
                  ) : (
                    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-canvas-alt p-2 text-[11px] text-fg">
                      {previewText}
                    </pre>
                  )
                ) : (
                  <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-canvas-alt p-4">
                    <FileText size={40} className="text-danger" />
                    <div className="text-center text-[12.5px] font-medium text-fg">{selected.name}</div>
                    <div className="text-[11px] text-fg-subtle">{selected.type} · {formatBytes(selected.size)}</div>
                  </div>
                ))}
              {detailTab === "details" && (
                <dl className="grid grid-cols-[70px_1fr] gap-y-1.5 text-[12.5px]">
                  <dt className="text-fg-muted">Path:</dt>
                  <dd className="break-all text-fg">{selected.path}</dd>
                  <dt className="text-fg-muted">Type:</dt>
                  <dd className="text-fg">{selected.type}</dd>
                  <dt className="text-fg-muted">Size:</dt>
                  <dd className="text-fg">{formatBytes(selected.size)}</dd>
                  <dt className="text-fg-muted">Modified:</dt>
                  <dd className="text-fg">{formatDate(selected.modified)}</dd>
                  {selected.hit && (
                    <>
                      <dt className="text-fg-muted">Matched:</dt>
                      <dd className="text-fg">{MATCH_BADGE[selected.hit.matchedIn].label}</dd>
                    </>
                  )}
                </dl>
              )}
              {detailTab === "occurrences" && (
                <div className="flex flex-col gap-1.5 text-[12px] text-fg-muted">
                  {!selected.hit && <p className="text-fg-subtle">Run a search to see occurrences.</p>}
                  {selected.hit?.matchedIn === "name" && <p className="text-fg-subtle">Matched by file name.</p>}
                  {selected.hit?.archiveEntries.map((entry) => (
                    <div key={entry} className="break-all rounded border border-border bg-surface-alt px-2 py-1">
                      {entry}
                    </div>
                  ))}
                  {selected.hit?.snippets.map((s, i) => (
                    <div key={i} className="break-all rounded border border-border bg-surface-alt px-2 py-1">
                      <span className="mr-1.5 text-fg-subtle">Line {formatNumber(s.line)}:</span>
                      <HighlightText text={s.text} term={highlightTerm} />
                    </div>
                  ))}
                  {selected.hit && selected.hit.occurrences > selected.hit.snippets.length && (
                    <p className="text-fg-subtle">
                      +{formatNumber(selected.hit.occurrences - selected.hit.snippets.length)} more in this file
                    </p>
                  )}
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  icon={FolderOpen}
                  disabled={!selected.hit}
                  onClick={() => selected.hit && void runAction(() => openPath(selected.hit!.path))}
                >
                  Open
                </Button>
                <Button
                  size="sm"
                  icon={FolderOpen}
                  disabled={!selected.hit}
                  onClick={() => selected.hit && void runAction(() => revealItemInDir(selected.hit!.path))}
                >
                  Open Folder
                </Button>
                <Button
                  size="sm"
                  icon={Copy}
                  onClick={() =>
                    void runAction(async () => {
                      await navigator.clipboard.writeText(selected.hit?.path ?? selected.path + selected.name);
                      toast.success("Path copied.");
                    })
                  }
                >
                  Copy Path
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-fg-subtle">Select a result to preview it.</p>
          )}
        </Card>
      </div>

      <Dialog
        open={saveDialog}
        onClose={() => setSaveDialog(false)}
        title="Save Search"
        footer={
          <>
            <Button onClick={() => setSaveDialog(false)}>Cancel</Button>
            <Button variant="primary" disabled={!savedName.trim()} onClick={saveCurrent}>Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-fg-muted">Name (an existing name is replaced)</label>
          <TextInput value={savedName} autoFocus onChange={(e) => setSavedName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveCurrent()} />
          <p className="text-[11.5px] text-fg-muted">Saves the location, search text, options and filters.</p>
        </div>
      </Dialog>

      <Dialog open={manageDialog} onClose={() => setManageDialog(false)} title="Saved Searches">
        <div className="flex flex-col gap-1.5">
          {saved.searches.length === 0 && <p className="text-[12.5px] text-fg-muted">No saved searches.</p>}
          {saved.searches.map((s) => (
            <div key={s.name} className="flex items-center gap-2 text-[12.5px]">
              <div className="min-w-0 flex-1">
                <div className="truncate text-fg">{s.name}</div>
                <div className="truncate text-[11.5px] text-fg-muted">"{s.term}" in {s.location}</div>
              </div>
              <Button size="sm" onClick={() => { applySaved(s.name); setManageDialog(false); }}>Load</Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => saved.remove(s.name)}>Delete</Button>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

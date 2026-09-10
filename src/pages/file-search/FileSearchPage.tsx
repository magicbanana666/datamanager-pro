import { useMemo, useState } from "react";
import { Copy, File, FileText, FolderOpen, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/cards/Card";
import { LocationPicker } from "@/components/controls/LocationPicker";
import { TextInput } from "@/components/controls/TextInput";
import { Select } from "@/components/controls/Select";
import { Button } from "@/components/controls/Button";
import { Checkbox } from "@/components/controls/Checkbox";
import { Tabs } from "@/components/controls/Tabs";
import { DemoBadge } from "@/components/controls/DemoBadge";
import { DataTable, type DataTableColumn } from "@/components/tables/DataTable";
import { HighlightText } from "@/components/controls/HighlightText";
import { savedSearches, searchResults } from "@/mock/search";
import type { SearchResultRow } from "@/models/search";
import { formatBytes, formatDate } from "@/utils/format";
import { toast } from "@/state/toastStore";

const RESULT_TABS = [
  { id: "results", label: "Results", badge: searchResults.length },
  { id: "preview", label: "Preview" },
  { id: "file-types", label: "File Types" },
  { id: "folders", label: "Folders" },
  { id: "timeline", label: "Timeline" },
];

const DETAIL_TABS = [
  { id: "preview", label: "Preview" },
  { id: "details", label: "Details" },
  { id: "occurrences", label: "Occurrences" },
];

export function FileSearchPage() {
  const [location, setLocation] = useState("D:\\Data\\Projects");
  const [term, setTerm] = useState("report");
  const [options, setOptions] = useState({
    fileName: true,
    fileContent: true,
    caseSensitive: false,
    regex: false,
    includeSubfolders: true,
    compressedArchives: false,
    networkShares: false,
  });
  const [resultTab, setResultTab] = useState("results");
  const [detailTab, setDetailTab] = useState("preview");
  const [selected, setSelected] = useState<SearchResultRow | null>(searchResults[0] ?? null);

  const rows = useMemo(() => searchResults, []);

  const columns: DataTableColumn<SearchResultRow>[] = [
    {
      key: "name",
      header: "Name",
      width: 260,
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="flex items-center gap-1.5 truncate">
          <File size={13} className="shrink-0 text-fg-subtle" />
          <HighlightText text={r.name} term={term} />
        </span>
      ),
    },
    { key: "path", header: "Path", width: 260, sortAccessor: (r) => r.path, render: (r) => <span className="truncate text-fg-muted">{r.path}</span> },
    { key: "size", header: "Size", width: 90, align: "right", sortAccessor: (r) => r.size, render: (r) => formatBytes(r.size) },
    { key: "type", header: "Type", width: 130, sortAccessor: (r) => r.type, render: (r) => <span className="text-fg-muted">{r.type}</span> },
    { key: "modified", header: "Modified", width: 140, sortAccessor: (r) => r.modified, render: (r) => formatDate(r.modified) },
  ];

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <PageHeader title="File Search" description="Find files by name or content across local and network locations." />

      <div className="flex items-stretch gap-3">
        <Card title="Search Location(s)" className="flex-1">
          <div className="flex flex-col gap-2">
            <LocationPicker value={location} onChange={setLocation} />
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
              <Checkbox checked={options.includeSubfolders} onChange={(v) => setOptions((o) => ({ ...o, includeSubfolders: v }))} label="Include subfolders" />
              <Checkbox checked={options.compressedArchives} onChange={(v) => setOptions((o) => ({ ...o, compressedArchives: v }))} label="Search compressed archives" />
              <Checkbox checked={options.networkShares} onChange={(v) => setOptions((o) => ({ ...o, networkShares: v }))} label="Search network shares" />
            </div>
          </div>
        </Card>
        <Card title="Search Criteria" className="flex-1">
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <TextInput icon={Search} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search term..." containerClassName="flex-1" />
              <Button variant="primary" icon={Search} onClick={() => toast.success(`Found ${searchResults.length} matches for "${term}".`)}>
                Search
              </Button>
              <Button icon={X} onClick={() => setTerm("")}>Clear</Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <Checkbox checked={options.fileName} onChange={(v) => setOptions((o) => ({ ...o, fileName: v }))} label="File name" />
              <Checkbox checked={options.fileContent} onChange={(v) => setOptions((o) => ({ ...o, fileContent: v }))} label="File content" />
              <Checkbox checked={options.caseSensitive} onChange={(v) => setOptions((o) => ({ ...o, caseSensitive: v }))} label="Case sensitive" />
              <Checkbox checked={options.regex} onChange={(v) => setOptions((o) => ({ ...o, regex: v }))} label="Regex" />
            </div>
          </div>
        </Card>
        <Card title="Saved Searches" className="w-[220px] shrink-0">
          <div className="flex flex-col gap-2">
            <Select options={savedSearches.map((s) => ({ value: s, label: s }))} />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => toast.demo()}>Save</Button>
              <Button size="sm" onClick={() => toast.demo()}>Manage...</Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[210px_1fr_300px] gap-3">
        <Card title="Filters" bodyClassName="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">File Types</label>
            <Select options={[{ value: "all", label: "All files (*.*)" }, { value: "docs", label: "Documents" }, { value: "media", label: "Media" }]} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Size</label>
            <div className="flex items-center gap-1.5">
              <TextInput placeholder="Min" containerClassName="flex-1" />
              <span className="text-fg-subtle">-</span>
              <TextInput placeholder="Max" containerClassName="flex-1" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Modified Date</label>
            <Select options={[{ value: "any", label: "Any time" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }, { value: "year", label: "This year" }]} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Attributes</label>
            <Checkbox checked={false} onChange={() => toast.demo()} label="Read-only" />
            <Checkbox checked={false} onChange={() => toast.demo()} label="Hidden" />
            <Checkbox checked={false} onChange={() => toast.demo()} label="System" />
            <Checkbox checked={false} onChange={() => toast.demo()} label="Archive" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium text-fg-muted">Content Options</label>
            <Checkbox checked={false} onChange={() => toast.demo()} label="Match whole words" />
            <Checkbox checked={true} onChange={() => toast.demo()} label="Search in file content" />
            <Checkbox checked={false} onChange={() => toast.demo()} label="Include binary files" />
          </div>
          <Button size="sm" onClick={() => toast.demo()}>More Filters...</Button>
        </Card>

        <Card padded={false} bodyClassName="flex flex-col gap-2 p-3 min-h-0" className="min-h-0">
          <div className="flex items-center justify-between gap-3">
            <Tabs tabs={RESULT_TABS} active={resultTab} onChange={setResultTab} className="min-w-0 flex-1" />
            <DemoBadge label="Demo Results" />
          </div>
          {resultTab === "results" && (
            <DataTable
              columns={columns}
              rows={rows}
              getRowId={(r) => r.id}
              selectedId={selected?.id ?? null}
              onRowClick={setSelected}
              className="flex-1"
            />
          )}
          {resultTab !== "results" && (
            <div className="flex flex-1 items-center justify-center text-xs text-fg-subtle">
              Sample "{RESULT_TABS.find((t) => t.id === resultTab)?.label}" view for this search - Phase 1 preview.
            </div>
          )}
        </Card>

        <Card padded={false} bodyClassName="flex flex-col gap-3 p-3 min-h-0" className="min-h-0 overflow-y-auto">
          <Tabs tabs={DETAIL_TABS} active={detailTab} onChange={setDetailTab} />
          {selected ? (
            <>
              {detailTab === "preview" && (
                <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-canvas-alt p-4">
                  <FileText size={40} className="text-danger" />
                  <div className="text-center text-[12.5px] font-medium text-fg">{selected.name}</div>
                  <div className="text-[11px] text-fg-subtle">{selected.type} · {formatBytes(selected.size)}</div>
                  <div className="mt-2 h-40 w-full rounded border border-border-strong bg-surface-alt" />
                </div>
              )}
              {detailTab === "details" && (
                <dl className="grid grid-cols-[70px_1fr] gap-y-1.5 text-[12.5px]">
                  <dt className="text-fg-muted">Path:</dt>
                  <dd className="truncate text-fg">{selected.path}</dd>
                  <dt className="text-fg-muted">Type:</dt>
                  <dd className="text-fg">{selected.type}</dd>
                  <dt className="text-fg-muted">Size:</dt>
                  <dd className="text-fg">{formatBytes(selected.size)}</dd>
                  <dt className="text-fg-muted">Modified:</dt>
                  <dd className="text-fg">{formatDate(selected.modified)}</dd>
                </dl>
              )}
              {detailTab === "occurrences" && (
                <div className="flex flex-col gap-1.5 text-[12.5px] text-fg-muted">
                  {Array.from({ length: selected.occurrences ?? 3 }).map((_, i) => (
                    <div key={i} className="rounded border border-border bg-surface-alt px-2 py-1">
                      Line {12 + i * 4}: ...<HighlightText text={`quarterly ${term} summary`} term={term} />...
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-auto flex gap-2 pt-2">
                <Button size="sm" icon={FolderOpen} onClick={() => toast.demo()}>Open</Button>
                <Button size="sm" icon={FolderOpen} onClick={() => toast.demo()}>Open Folder</Button>
                <Button size="sm" icon={Copy} onClick={() => toast.demo()}>Copy Path</Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-fg-subtle">Select a result to preview it.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Dialog } from "@/components/dialogs/Dialog";
import { Tabs } from "@/components/controls/Tabs";
import { Toggle } from "@/components/controls/Toggle";
import { Select } from "@/components/controls/Select";
import { RadioGroup } from "@/components/controls/RadioGroup";
import { TextInput } from "@/components/controls/TextInput";
import { Button } from "@/components/controls/Button";
import { useUiStore } from "@/state/uiStore";
import { useSettingsStore } from "@/state/settingsStore";
import { toast } from "@/state/toastStore";

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "scanning", label: "Scanning" },
  { id: "file-operations", label: "File Operations" },
  { id: "network", label: "Network" },
  { id: "reports", label: "Reports" },
  { id: "advanced", label: "Advanced" },
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-fg-muted">{label}</label>
      {children}
      {hint && <span className="text-[11px] text-fg-subtle">{hint}</span>}
    </div>
  );
}

export function SettingsDialog() {
  const { settingsOpen, closeSettings } = useUiStore();
  const { settings, updateSection, reset } = useSettingsStore();
  const [section, setSection] = useState("general");

  return (
    <Dialog
      open={settingsOpen}
      onClose={closeSettings}
      title="Settings"
      width={620}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              toast.info("Settings restored to defaults.");
            }}
          >
            Restore Defaults
          </Button>
          <Button variant="primary" onClick={closeSettings}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Tabs tabs={SECTIONS.map((s) => ({ id: s.id, label: s.label }))} active={section} onChange={setSection} />

        {section === "general" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Launch behavior">
              <Select
                value={settings.general.launchBehavior}
                onChange={(e) => updateSection("general", { launchBehavior: e.target.value as typeof settings.general.launchBehavior })}
                options={[
                  { value: "show-overview", label: "Show Overview dashboard" },
                  { value: "restore-last-session", label: "Restore last session" },
                  { value: "show-new-scan", label: "Show New Scan dialog" },
                ]}
              />
            </Field>
            <div className="flex flex-col gap-3 pt-5">
              <Toggle
                checked={settings.general.rememberLastLocation}
                onChange={(v) => updateSection("general", { rememberLastLocation: v })}
                label="Remember last location"
              />
              <Toggle
                checked={settings.general.checkForUpdates}
                onChange={(v) => updateSection("general", { checkForUpdates: v })}
                label="Check for updates on launch"
              />
            </div>
          </div>
        )}

        {section === "appearance" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Theme" hint="Dark mode only in Phase 1.">
              <Select value="dark" disabled options={[{ value: "dark", label: "Dark (selected)" }]} />
            </Field>
            <Field label="Density">
              <RadioGroup
                name="density"
                direction="horizontal"
                value={settings.appearance.density}
                onChange={(v) => updateSection("appearance", { density: v })}
                options={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "compact", label: "Compact" },
                ]}
              />
            </Field>
            <Field label="Accent preference">
              <Select
                value={settings.appearance.accent}
                onChange={(e) => updateSection("appearance", { accent: e.target.value as typeof settings.appearance.accent })}
                options={[
                  { value: "blue", label: "Blue (default)" },
                  { value: "teal", label: "Teal" },
                  { value: "purple", label: "Purple" },
                  { value: "green", label: "Green" },
                ]}
              />
            </Field>
          </div>
        )}

        {section === "scanning" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Default thread count">
              <TextInput
                type="number"
                min={1}
                max={64}
                value={settings.scanning.defaultThreadCount}
                onChange={(e) => updateSection("scanning", { defaultThreadCount: Number(e.target.value) })}
              />
            </Field>
            <div className="flex flex-col gap-3 pt-5">
              <Toggle
                checked={settings.scanning.followJunctions}
                onChange={(v) => updateSection("scanning", { followJunctions: v })}
                label="Follow junctions / symlinks"
              />
              <Toggle
                checked={settings.scanning.includeHiddenFiles}
                onChange={(v) => updateSection("scanning", { includeHiddenFiles: v })}
                label="Include hidden files"
              />
            </div>
          </div>
        )}

        {section === "file-operations" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Default collision behavior">
              <Select
                value={settings.fileOperations.defaultCollisionBehavior}
                onChange={(e) =>
                  updateSection("fileOperations", {
                    defaultCollisionBehavior: e.target.value as typeof settings.fileOperations.defaultCollisionBehavior,
                  })
                }
                options={[
                  { value: "skip-same", label: "Skip if same size/date" },
                  { value: "compare-hash", label: "Compare hash" },
                  { value: "rename-new", label: "Rename new file" },
                  { value: "overwrite-older", label: "Overwrite older file" },
                ]}
              />
            </Field>
            <div className="flex flex-col gap-3 pt-5">
              <Toggle
                checked={settings.fileOperations.verifyAfterCopy}
                onChange={(v) => updateSection("fileOperations", { verifyAfterCopy: v })}
                label="Verify files after copy"
              />
              <Toggle
                checked={settings.fileOperations.preserveTimestamps}
                onChange={(v) => updateSection("fileOperations", { preserveTimestamps: v })}
                label="Preserve timestamps"
              />
            </div>
          </div>
        )}

        {section === "network" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Timeout (seconds)">
              <TextInput
                type="number"
                min={1}
                max={120}
                value={settings.network.timeoutSeconds}
                onChange={(e) => updateSection("network", { timeoutSeconds: Number(e.target.value) })}
              />
            </Field>
            <Field label="Concurrency">
              <TextInput
                type="number"
                min={1}
                max={256}
                value={settings.network.concurrency}
                onChange={(e) => updateSection("network", { concurrency: Number(e.target.value) })}
              />
            </Field>
            <Toggle
              checked={settings.network.resolveHostnames}
              onChange={(v) => updateSection("network", { resolveHostnames: v })}
              label="Resolve hostnames"
            />
          </div>
        )}

        {section === "reports" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Default format">
              <Select
                value={settings.reports.defaultFormat}
                onChange={(e) => updateSection("reports", { defaultFormat: e.target.value as typeof settings.reports.defaultFormat })}
                options={[
                  { value: "PDF", label: "PDF (Recommended)" },
                  { value: "HTML", label: "HTML" },
                  { value: "XLSX", label: "Excel (.xlsx)" },
                  { value: "CSV", label: "CSV" },
                ]}
              />
            </Field>
            <Field label="Default output folder">
              <TextInput
                value={settings.reports.defaultOutputFolder}
                onChange={(e) => updateSection("reports", { defaultOutputFolder: e.target.value })}
              />
            </Field>
          </div>
        )}

        {section === "advanced" && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Log level">
              <Select
                value={settings.advanced.logLevel}
                onChange={(e) => updateSection("advanced", { logLevel: e.target.value as typeof settings.advanced.logLevel })}
                options={[
                  { value: "error", label: "Error" },
                  { value: "warn", label: "Warn" },
                  { value: "info", label: "Info" },
                  { value: "debug", label: "Debug" },
                  { value: "trace", label: "Trace" },
                ]}
              />
            </Field>
            <div className="pt-5">
              <Toggle
                checked={settings.advanced.developerMode}
                onChange={(v) => updateSection("advanced", { developerMode: v })}
                label="Developer mode"
              />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

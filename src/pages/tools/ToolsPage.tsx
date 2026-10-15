import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileCode, FolderOpen, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { TextInput } from "@/components/controls/TextInput";
import { Button } from "@/components/controls/Button";
import { ToolCard } from "@/components/cards/ToolCard";
import { toolCategories } from "@/pages/tools/toolCatalog";
import { ToolDialog } from "@/pages/tools/ToolDialog";
import { dataFolder, launchSystemTool } from "@/api/tools";
import { openFolder } from "@/api/transfer";
import { toAppError } from "@/api/backend";
import type { ToolDefinition, ToolDialogId } from "@/models/tools";
import { toast } from "@/state/toastStore";
import { useUiStore } from "@/state/uiStore";

export function ToolsPage() {
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<ToolDialogId | null>(null);
  const navigate = useNavigate();
  const openSettings = useUiStore((s) => s.openSettings);

  function open(tool: ToolDefinition) {
    const action = tool.action;
    switch (action.kind) {
      case "route":
        navigate(action.to);
        break;
      case "dialog":
        setDialog(action.dialog);
        break;
      case "settings":
        openSettings();
        break;
      case "system":
        launchSystemTool(action.tool).catch((e) => toast.danger(toAppError(e).message));
        break;
    }
  }

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return toolCategories;
    return toolCategories
      .map((group) => ({
        ...group,
        tools: group.tools.filter(
          (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.tools.length > 0);
  }, [query]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title="Tools"
        description="Additional utilities to help you manage, analyze and maintain your data."
        actions={
          <>
            <TextInput icon={Search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tools..." containerClassName="w-56" />
            <Button icon={FolderOpen} onClick={() => dataFolder().then(openFolder).catch((e) => toast.danger(toAppError(e).message))}>
              Open Data Folder
            </Button>
            <Button icon={FileCode} onClick={() => setDialog("script")}>Run Script...</Button>
          </>
        }
      />

      <div className="flex flex-col gap-5">
        {filteredGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-2.5">
            <h2 className="text-[13px] font-semibold text-fg">{group.title}</h2>
            <div className="grid grid-cols-6 gap-2.5">
              {group.tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} onOpen={open} />
              ))}
            </div>
          </div>
        ))}
        {filteredGroups.length === 0 && <p className="text-sm text-fg-subtle">No tools match "{query}".</p>}
      </div>
      <ToolDialog dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

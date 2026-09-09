import { useMemo, useState } from "react";
import { FolderOpen, Puzzle, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { TextInput } from "@/components/controls/TextInput";
import { Button } from "@/components/controls/Button";
import { ToolCard } from "@/components/cards/ToolCard";
import { toolCategories } from "@/mock/tools";
import { toast } from "@/state/toastStore";

export function ToolsPage() {
  const [query, setQuery] = useState("");

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
            <Button icon={FolderOpen} onClick={() => toast.demo()}>Open Tools Folder</Button>
            <Button icon={Puzzle} onClick={() => toast.demo()}>Custom Tools...</Button>
          </>
        }
      />

      <div className="flex flex-col gap-5">
        {filteredGroups.map((group) => (
          <div key={group.id} className="flex flex-col gap-2.5">
            <h2 className="text-[13px] font-semibold text-fg">{group.title}</h2>
            <div className="grid grid-cols-6 gap-2.5">
              {group.tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
            </div>
          </div>
        ))}
        {filteredGroups.length === 0 && <p className="text-sm text-fg-subtle">No tools match "{query}".</p>}
      </div>
    </div>
  );
}

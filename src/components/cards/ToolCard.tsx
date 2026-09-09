import { useNavigate } from "react-router-dom";
import type { ToolDefinition } from "@/models/tools";
import { Button } from "@/components/controls/Button";
import { toast } from "@/state/toastStore";
import { chartColor } from "@/utils/colors";

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  const navigate = useNavigate();
  const Icon = tool.icon;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-3.5">
      <div className="flex items-start gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
          style={{ backgroundColor: `${chartColor(tool.accentColorIndex)}22`, color: chartColor(tool.accentColorIndex) }}
        >
          <Icon size={18} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-fg">{tool.name}</div>
          <div className="text-xs text-fg-muted leading-snug">{tool.description}</div>
        </div>
      </div>
      <Button
        size="sm"
        className="mt-auto self-start"
        onClick={() => (tool.route ? navigate(tool.route) : toast.demo())}
      >
        Open
      </Button>
    </div>
  );
}

import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/controls/Badge";

/** Marks simulated content - now only the IP / Port Scanner page, which
 * stays a demonstration (see PHASE8.md). */
export function DemoBadge({ label = "Demo" }: { label?: string }) {
  return (
    <Badge tone="warning" className="gap-1">
      <FlaskConical size={11} />
      {label}
    </Badge>
  );
}

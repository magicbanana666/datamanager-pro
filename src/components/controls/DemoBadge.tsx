import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/controls/Badge";

/** Marks simulated content (the IP / Port Scanner page). */
export function DemoBadge({ label = "Demo" }: { label?: string }) {
  return (
    <Badge tone="warning" className="gap-1">
      <FlaskConical size={11} />
      {label}
    </Badge>
  );
}

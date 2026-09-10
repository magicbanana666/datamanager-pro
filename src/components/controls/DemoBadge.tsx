import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/controls/Badge";

/** Marks an analytical widget that still runs on Phase 1 mock data
 * (the recursive scanner behind treemaps/charts is Phase 3+) so real
 * volume/folder data introduced in Phase 2 is never mixed with fake
 * totals in a way that could mislead the user. */
export function DemoBadge({ label = "Demo Visualization" }: { label?: string }) {
  return (
    <Badge tone="warning" className="gap-1">
      <FlaskConical size={11} />
      {label}
    </Badge>
  );
}

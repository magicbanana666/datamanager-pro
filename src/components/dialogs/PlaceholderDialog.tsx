import { Info } from "lucide-react";
import { Dialog } from "@/components/dialogs/Dialog";
import { Button } from "@/components/controls/Button";
import { useUiStore } from "@/state/uiStore";

/** Generic "not implemented yet" dialog, shown by toolbar buttons like
 * New Scan / Open Project / Save Project. */
export function PlaceholderDialog() {
  const { placeholderDialog, closePlaceholderDialog } = useUiStore();

  return (
    <Dialog
      open={placeholderDialog.open}
      onClose={closePlaceholderDialog}
      title={placeholderDialog.title}
      footer={<Button variant="primary" onClick={closePlaceholderDialog}>OK</Button>}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Info size={18} />
        </div>
        <p className="text-[13px] leading-relaxed text-fg-muted">{placeholderDialog.message}</p>
      </div>
    </Dialog>
  );
}

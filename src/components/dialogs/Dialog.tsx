import type { ReactNode } from "react";
import { X } from "lucide-react";
import clsx from "clsx";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Dialog({ open, onClose, title, children, footer, width = 480 }: DialogProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{ width }}
        className={clsx(
          "flex max-h-[85vh] flex-col rounded-lg border border-border-strong bg-surface shadow-2xl",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-semibold text-fg">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

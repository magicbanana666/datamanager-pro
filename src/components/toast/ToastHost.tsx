import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import clsx from "clsx";
import { useToastStore, type ToastTone } from "@/state/toastStore";

const toneIcon: Record<ToastTone, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const toneClasses: Record<ToastTone, string> = {
  info: "border-accent/40 text-accent",
  success: "border-success/40 text-success",
  warning: "border-warning/40 text-warning",
  danger: "border-danger/40 text-danger",
};

export function ToastHost() {
  const { toasts, dismiss } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-11 right-3 z-[60] flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = toneIcon[t.tone];
        return (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto flex w-80 items-start gap-2.5 rounded-md border bg-surface-alt p-3 shadow-xl",
              toneClasses[t.tone],
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              {t.title && <div className="text-[12.5px] font-semibold text-fg">{t.title}</div>}
              <div className="text-[12px] leading-snug text-fg-muted">{t.message}</div>
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 cursor-pointer text-fg-subtle hover:text-fg"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

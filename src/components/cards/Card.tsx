import type { ReactNode } from "react";
import clsx from "clsx";

interface CardProps {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}

export function Card({ title, action, children, className, bodyClassName, padded = true }: CardProps) {
  return (
    <div className={clsx("flex min-w-0 flex-col rounded-lg border border-border bg-surface", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
          {typeof title === "string" ? <h3 className="text-[13px] font-semibold text-fg">{title}</h3> : title}
          {action}
        </div>
      )}
      <div className={clsx(padded && "p-3.5", "flex-1 min-h-0", bodyClassName)}>{children}</div>
    </div>
  );
}

import { ChevronRight, HardDrive, Server } from "lucide-react";
import clsx from "clsx";

interface PathBreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
  className?: string;
}

/** Splits a Windows or UNC path into clickable segments, e.g.
 * `D:\Data\Projects\Clients\AMGroup` -> `D: > Data > Projects > Clients
 * > AMGroup`, or `\\NAS\CompanyData\Projects` -> `NAS > CompanyData >
 * Projects`. Clicking a segment navigates to that ancestor directory. */
export function PathBreadcrumb({ path, onNavigate, className }: PathBreadcrumbProps) {
  const isUnc = path.startsWith("\\\\");
  const stripped = isUnc ? path.slice(2) : path;
  const segments = stripped.split("\\").filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  function pathUpTo(index: number): string {
    const parts = segments.slice(0, index + 1);
    if (isUnc) return "\\\\" + parts.join("\\");
    return parts.length === 1 ? `${parts[0]}\\` : parts.join("\\");
  }

  return (
    <div className={clsx("flex min-w-0 items-center gap-1 overflow-x-auto text-[12px]", className)}>
      {isUnc ? (
        <Server size={13} className="shrink-0 text-fg-subtle" />
      ) : (
        <HardDrive size={13} className="shrink-0 text-fg-subtle" />
      )}
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => !isLast && onNavigate(pathUpTo(i))}
              disabled={isLast}
              className={clsx(
                "rounded px-1 py-0.5 transition-colors cursor-pointer",
                isLast
                  ? "text-fg font-medium cursor-default"
                  : "text-fg-muted hover:text-accent hover:bg-surface-hover",
              )}
            >
              {segment}
            </button>
            {!isLast && <ChevronRight size={12} className="text-fg-subtle" />}
          </span>
        );
      })}
    </div>
  );
}

import clsx from "clsx";

export interface TabItem {
  id: string;
  label: string;
  badge?: string | number;
}

interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div
      className={clsx(
        "flex items-center gap-1 overflow-x-auto rounded-md border border-border bg-surface p-1",
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={clsx(
              "flex shrink-0 items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors cursor-pointer",
              isActive ? "bg-accent text-fg-on-accent" : "text-fg-muted hover:bg-surface-hover hover:text-fg",
            )}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span
                className={clsx(
                  "rounded-full px-1.5 py-[1px] text-[11px] font-semibold",
                  isActive ? "bg-white/25 text-fg-on-accent" : "bg-border-strong text-fg-muted",
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

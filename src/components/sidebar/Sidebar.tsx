import { NavLink } from "react-router-dom";
import { Database } from "lucide-react";
import clsx from "clsx";
import { NAV_ENTRIES } from "@/components/app-shell/navConfig";

export function Sidebar() {
  return (
    <aside className="flex h-full w-[196px] shrink-0 flex-col border-r border-border bg-canvas-alt">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-fg-on-accent">
          <Database size={17} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[14px] font-bold text-fg">DataManager Pro</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2.5">
        <ul className="flex flex-col gap-0.5">
          {NAV_ENTRIES.map((item) => (
            <li key={item.id}>
              <NavLink
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors",
                    isActive
                      ? "bg-accent text-fg-on-accent"
                      : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                  )
                }
              >
                <item.icon size={16} strokeWidth={2} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-border px-4 py-3 text-[11px] font-medium leading-[1.6] text-fg-subtle">
        Analyze.
        <br />
        Migrate.
        <br />
        Manage.
        <br />
        Your Data.
      </div>
    </aside>
  );
}

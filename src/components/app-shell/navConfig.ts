import {
  ArrowLeftRight,
  Calendar,
  ClipboardList,
  Copy,
  Folder,
  GitCompare,
  HardDrive,
  Home,
  Network,
  RefreshCw,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavEntry {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

export const NAV_ENTRIES: NavEntry[] = [
  { id: "overview", label: "Overview", path: "/", icon: Home },
  { id: "disk-analysis", label: "Disk Analysis", path: "/disk-analysis", icon: HardDrive },
  { id: "folder-analysis", label: "Folder Analysis", path: "/folder-analysis", icon: Folder },
  { id: "network-analysis", label: "Network Analysis", path: "/network-analysis", icon: Network },
  { id: "comparison", label: "Comparison", path: "/comparison", icon: GitCompare },
  { id: "file-search", label: "File Search", path: "/file-search", icon: Search },
  { id: "duplicate-finder", label: "Duplicate Finder", path: "/duplicate-finder", icon: Copy },
  { id: "data-transfer", label: "Data Transfer", path: "/data-transfer", icon: ArrowLeftRight },
  { id: "sync", label: "Sync / Incremental", path: "/sync", icon: RefreshCw },
  { id: "scheduler", label: "Scheduler", path: "/scheduler", icon: Calendar },
  { id: "reports", label: "Reports", path: "/reports", icon: ClipboardList },
  { id: "tools", label: "Tools", path: "/tools", icon: Wrench },
];

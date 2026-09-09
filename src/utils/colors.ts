/** Categorical chart palette (mirrors the CSS custom properties in
 * styles/index.css so charts rendered via SVG/Recharts and plain CSS stay
 * in sync). Access by index and it wraps around. */
export const CHART_PALETTE = [
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#ef4444",
  "#a855f7",
  "#eab308",
  "#64748b",
  "#14b8a6",
  "#ec4899",
  "#84cc16",
] as const;

export function chartColor(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

export const STATUS_COLORS: Record<StatusTone, string> = {
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#38bdf8",
  neutral: "#8b96a8",
  accent: "#3b82f6",
};

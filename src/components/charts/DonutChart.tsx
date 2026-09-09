import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { CategoryStat } from "@/models/common";
import { chartColor } from "@/utils/colors";
import { formatBytes } from "@/utils/format";

interface DonutChartProps {
  data: CategoryStat[];
  centerLabel: string;
  centerValue: string;
  size?: number;
  showLegend?: boolean;
  valueFormatter?: (v: number) => string;
}

export function DonutChart({
  data,
  centerLabel,
  centerValue,
  size = 150,
  showLegend = true,
  valueFormatter = formatBytes,
}: DonutChartProps) {
  return (
    <div className="flex items-center gap-4">
      <div style={{ width: size, height: size }} className="relative shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={1.5}
              stroke="none"
            >
              {data.map((d, i) => (
                <Cell key={i} fill={chartColor(d.colorIndex)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => valueFormatter(Number(value))}
              contentStyle={{
                background: "var(--color-surface-alt)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--color-fg)",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-semibold text-fg">{centerValue}</span>
          <span className="text-[10px] text-fg-muted">{centerLabel}</span>
        </div>
      </div>
      {showLegend && (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: chartColor(d.colorIndex) }}
              />
              <span className="min-w-0 flex-1 truncate text-fg-muted">{d.label}</span>
              <span className="shrink-0 text-fg-subtle">{d.percent.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

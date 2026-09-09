import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatBytes } from "@/utils/format";

interface Series {
  key: string;
  label: string;
  color: string;
}

interface BarChartPanelProps<T> {
  data: T[];
  categoryKey: keyof T & string;
  series: Series[];
  height?: number;
  valueFormatter?: (v: number) => string;
}

const tickStyle = { fill: "var(--color-fg-subtle)", fontSize: 11 };

export function BarChartPanel<T extends object>({
  data,
  categoryKey,
  series,
  height = 220,
  valueFormatter = formatBytes,
}: BarChartPanelProps<T>) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data as Record<string, unknown>[]} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey={categoryKey as string} tick={tickStyle} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} />
        <YAxis
          tick={tickStyle}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={(v: number) => valueFormatter(v)}
        />
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
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-fg-muted)" }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

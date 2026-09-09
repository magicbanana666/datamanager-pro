import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface LineSeries {
  key: string;
  label: string;
  color: string;
}

interface LineChartPanelProps<T> {
  data: T[];
  categoryKey: keyof T & string;
  series: LineSeries[];
  height?: number;
  valueFormatter?: (v: number) => string;
  filled?: boolean;
}

const tickStyle = { fill: "var(--color-fg-subtle)", fontSize: 11 };

export function LineChartPanel<T extends object>({
  data,
  categoryKey,
  series,
  height = 160,
  valueFormatter = (v) => String(v),
  filled = true,
}: LineChartPanelProps<T>) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data as Record<string, unknown>[]} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey={categoryKey as string} tick={tickStyle} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} />
        <YAxis tick={tickStyle} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => valueFormatter(v)} />
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
        {series.map((s) =>
          filled ? (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              dot={false}
              isAnimationActive={false}
            />
          ) : (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ),
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}

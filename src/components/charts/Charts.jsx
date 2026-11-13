import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Thin, themed wrappers around Recharts.
 *
 * Every chart in the app goes through these so the grid, tooltip and axis
 * colours come from the same design tokens as the rest of the workspace -
 * a chart must follow the light/dark switch without any page-level work.
 */

const AXIS = 'var(--color-dim)';
const GRID = 'var(--color-line)';

function useTooltipStyle() {
  return useMemo(
    () => ({
      contentStyle: {
        background: 'var(--color-elevated)',
        border: '1px solid var(--color-line2)',
        borderRadius: 10,
        fontSize: 12,
        color: 'var(--color-ink)',
        boxShadow: '0 18px 40px -24px rgba(0,0,0,0.9)',
      },
      labelStyle: { color: 'var(--color-muted)', marginBottom: 4 },
      itemStyle: { color: 'var(--color-ink)' },
      cursor: { fill: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
    }),
    [],
  );
}

function EmptyChart({ height, message }) {
  return (
    <div className="flex items-center justify-center text-[12.5px] text-[var(--color-dim)]" style={{ height }}>
      {message}
    </div>
  );
}

/** Trend over time - one line per series. `dataKey` values are numeric. */
export function TrendChart({
  data = [],
  xKey = 'date',
  series = [],
  height = 220,
  type = 'line',
  emptyMessage = 'No data',
  suffix = '',
}) {
  // The tooltip style is a hook, so it has to be resolved before any early
  // return - the first paint of every chart is the empty state.
  const tooltip = useTooltipStyle();
  if (!data.length) return <EmptyChart height={height} message={emptyMessage} />;
  const Chart = type === 'area' ? AreaChart : LineChart;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`fill-${s.key}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color || 'var(--accent)'} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color || 'var(--accent)'} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fill: AXIS, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          minTickGap={16}
        />
        <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
        <Tooltip {...tooltip} formatter={(value) => `${value}${suffix}`} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s, i) =>
          type === 'area' ? (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color || 'var(--accent)'}
              strokeWidth={2}
              fill={`url(#fill-${s.key}-${i})`}
              dot={false}
            />
          ) : (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color || 'var(--accent)'}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3.5 }}
            />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  );
}

/** Grouped / stacked columns. `stackId` on a series stacks them. */
export function BarsChart({
  data = [],
  xKey = 'month',
  series = [],
  height = 220,
  stacked = false,
  emptyMessage = 'No data',
}) {
  const tooltip = useTooltipStyle();
  if (!data.length) return <EmptyChart height={height} message={emptyMessage} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
        <Tooltip {...tooltip} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={s.color || 'var(--accent)'}
            radius={stacked ? 0 : [4, 4, 0, 0]}
            stackId={stacked ? 'stack' : undefined}
            maxBarSize={26}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars - good for "top N" lists such as defaulters or expenses. */
export function RankedBars({ data = [], xKey = 'label', valueKey = 'value', height = 240, color, emptyMessage = 'No data' }) {
  const tooltip = useTooltipStyle();
  if (!data.length) return <EmptyChart height={height} message={emptyMessage} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey={xKey} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={110} />
        <Tooltip {...tooltip} />
        <Bar dataKey={valueKey} fill={color || 'var(--accent)'} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const PIE_COLORS = [
  'var(--accent)',
  'var(--color-ok)',
  'var(--color-warn)',
  'var(--color-info)',
  'var(--color-danger)',
  'var(--accent-2)',
];

/** Donut with a centred total. `data` is [{ name, value }]. */
export function DonutChart({ data = [], height = 200, centerLabel, centerValue, emptyMessage = 'No data' }) {
  const tooltip = useTooltipStyle();
  const total = data.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  if (!data.length || total === 0) return <EmptyChart height={height} message={emptyMessage} />;

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="86%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((row, index) => (
              <Cell key={row.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip {...tooltip} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[20px] font-semibold leading-none text-[var(--color-ink)]">{centerValue ?? total}</span>
        {centerLabel && <span className="mt-1 text-[11px] text-[var(--color-dim)]">{centerLabel}</span>}
      </div>
    </div>
  );
}

/** Tiny inline sparkline for a stat card. */
export function Sparkline({ data = [], dataKey = 'value', height = 34, color = 'var(--accent)' }) {
  if (data.length < 2) return null;
  const points = data.map((row, index) => ({ index, [dataKey]: Number(row[dataKey]) || 0 }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.6} fill="url(#spark)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default { TrendChart, BarsChart, RankedBars, DonutChart, Sparkline };
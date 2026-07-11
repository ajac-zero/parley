/**
 * Native views for Parley's first-party charts catalog
 * (catalogs/charts/v1/catalog.json): the A2UI Basic Catalog plus two leaf
 * components — `Chart` (line/bar/area over data-model rows, with optional
 * point/range selection written back through two-way binding) and `Stat`
 * (a labeled headline number with an optional delta).
 *
 * Loaded lazily from the catalog registry (~/components/a2ui/catalog) so
 * recharts stays out of the main bundle. Everything renders from the
 * declarative resource: series colors are restricted to the host theme's
 * chart tokens, series keys are validated before they touch CSS variable
 * names, and malformed data degrades to an inert placeholder.
 *
 * Chart animations are deliberately disabled: a surface re-renders on
 * every streamed data-model update, which recharts' animation system
 * cannot tolerate (it loops until React aborts), and charts usually
 * appear mid-stream anyway.
 */

import { TrendingDown, TrendingUp } from "lucide-react";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
} from "recharts";
import type { ViewProps } from "~/components/a2ui/catalog";
import { useA2uiSurface } from "~/components/a2ui/context";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "~/components/ui/chart";
import {
  pointerGet,
  resolveDynamic,
  resolvePath,
  resolveString,
  toDisplayString,
} from "~/lib/a2ui";
import { cn } from "~/lib/utils";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const toNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/* ---------------------------------- Chart --------------------------------- */

/**
 * Series keys feed recharts `dataKey`s and the chart config that
 * `ChartContainer` turns into `--color-<key>` CSS custom properties inside
 * a generated <style> tag. Keys come from an untrusted resource, so only
 * this safe shape participates; anything else is dropped (the catalog
 * contract enforces the same pattern).
 */
const SAFE_SERIES_KEY = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/** The theme tokens a resource may pick for a series (never raw colors). */
const CHART_COLOR_TOKENS = new Set([
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
]);

interface SeriesSpec {
  key: string;
  label: string;
  /** One of the `chart-N` theme tokens. */
  color: string;
}

function parseSeries(value: unknown): SeriesSpec[] {
  if (!Array.isArray(value)) return [];
  const series: SeriesSpec[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (typeof record?.key !== "string" || !SAFE_SERIES_KEY.test(record.key)) {
      continue;
    }
    series.push({
      key: record.key,
      label:
        typeof record.label === "string" && record.label.length > 0
          ? record.label
          : record.key,
      color:
        typeof record.color === "string" && CHART_COLOR_TOKENS.has(record.color)
          ? record.color
          : `chart-${(series.length % 5) + 1}`,
    });
  }
  return series;
}

interface SelectionSpec {
  pointer: string;
  mode: "point" | "range";
}

function parseSelection(value: unknown, base: string): SelectionSpec | null {
  const record = asRecord(value);
  if (typeof record?.path !== "string") return null;
  return {
    pointer: resolvePath(record.path, base),
    mode: record.mode === "range" ? "range" : "point",
  };
}

function ChartPlaceholder() {
  return (
    <div className="flex h-24 w-full items-center justify-center rounded-lg border border-dashed text-muted-foreground text-xs">
      No chart data
    </div>
  );
}

export function ChartView({ component, base }: ViewProps) {
  const { dataModel, setValue, disabled } = useA2uiSurface();

  const title = resolveString(component.title, dataModel, base);
  const variant = toDisplayString(component.variant) || "line";
  const stacked = component.stacked === true;
  const height = Math.min(
    Math.max(toNumber(component.height) ?? 256, 160),
    480,
  );

  const xRecord = asRecord(component.x);
  const xKey = typeof xRecord?.key === "string" ? xRecord.key : null;
  const xLabel = typeof xRecord?.label === "string" ? xRecord.label : null;
  const series = useMemo(
    () => parseSeries(component.series),
    [component.series],
  );
  const selection = parseSelection(component.selection, base);

  const rawRows = resolveDynamic(component.data, dataModel, base);
  const rows = useMemo(
    () =>
      Array.isArray(rawRows)
        ? rawRows.filter(
            (row): row is Record<string, unknown> => asRecord(row) !== null,
          )
        : [],
    [rawRows],
  );

  const config = useMemo(() => {
    const entries: ChartConfig = {};
    for (const spec of series) {
      entries[spec.key] = { label: spec.label, color: `var(--${spec.color})` };
    }
    return entries;
  }, [series]);

  /* The currently selected point index (point mode), read back from the
   * bound selection value so the chart can highlight it. */
  const selected =
    selection?.mode === "point"
      ? asRecord(pointerGet(dataModel, selection.pointer))
      : null;
  const selectedIndex = toNumber(selected?.index);

  if (!xKey || series.length === 0 || rows.length === 0) {
    return <ChartPlaceholder />;
  }

  const selectPointAt = (index: number | null) => {
    if (disabled || !selection || selection.mode !== "point") return;
    const row = index !== null ? rows[index] : undefined;
    if (index === null || !row) return;
    const values: Record<string, unknown> = {};
    for (const spec of series) values[spec.key] = row[spec.key];
    setValue(selection.pointer, {
      mode: "point",
      index,
      x: row[xKey],
      values,
    });
  };

  /* Chart-level clicks resolve the point from recharts' hover state (fine
   * for line/area); bars also get a per-bar handler, which carries the
   * exact index even without a preceding mousemove (touch, synthetic
   * clicks). */
  const selectPoint = (state: unknown) => {
    selectPointAt(toNumber(asRecord(state)?.activeTooltipIndex));
  };

  const selectBar = (_entry: unknown, index: number) => {
    selectPointAt(Number.isInteger(index) ? index : null);
  };

  const selectRange = (range: unknown) => {
    if (disabled || !selection || selection.mode !== "range") return;
    const record = asRecord(range);
    const startIndex = toNumber(record?.startIndex);
    const endIndex = toNumber(record?.endIndex);
    if (startIndex === null || endIndex === null) return;
    setValue(selection.pointer, {
      mode: "range",
      startIndex,
      endIndex,
      from: rows[startIndex]?.[xKey],
      to: rows[endIndex]?.[xKey],
    });
  };

  const shared = {
    accessibilityLayer: true,
    data: rows,
    onClick: selectPoint,
  } as const;
  const grid = <CartesianGrid vertical={false} />;
  const xAxis = (
    <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} />
  );
  const tooltip = (
    <ChartTooltip cursor content={<ChartTooltipContent indicator="dot" />} />
  );
  const legend =
    series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null;
  const brush =
    selection?.mode === "range" ? (
      <Brush
        dataKey={xKey}
        height={20}
        travellerWidth={8}
        stroke="var(--muted-foreground)"
        fill="transparent"
        onChange={selectRange}
      />
    ) : null;
  /* Non-selected points dim once a point is picked (bar charts only —
   * recharts Cells are per-bar). */
  const cells = (spec: SeriesSpec) =>
    selectedIndex !== null
      ? rows.map((_, index) => (
          <Cell
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
            key={index}
            fillOpacity={index === selectedIndex ? 1 : 0.35}
            fill={`var(--color-${spec.key})`}
          />
        ))
      : null;

  return (
    <div className="flex w-full flex-col gap-2">
      {title.length > 0 && <div className="font-medium text-sm">{title}</div>}
      <ChartContainer
        config={config}
        style={{ height }}
        className={cn(
          "aspect-auto w-full",
          selection?.mode === "point" && !disabled && "cursor-pointer",
        )}
        aria-label={xLabel ? `${title || "Chart"} by ${xLabel}` : undefined}
      >
        {variant === "bar" ? (
          <BarChart {...shared}>
            {grid}
            {xAxis}
            {tooltip}
            {legend}
            {brush}
            {series.map((spec) => (
              <Bar
                key={spec.key}
                dataKey={spec.key}
                fill={`var(--color-${spec.key})`}
                radius={4}
                stackId={stacked ? "stack" : undefined}
                onClick={selectBar}
                isAnimationActive={false}
              >
                {cells(spec)}
              </Bar>
            ))}
          </BarChart>
        ) : variant === "area" ? (
          <AreaChart {...shared}>
            {grid}
            {xAxis}
            {tooltip}
            {legend}
            {brush}
            {series.map((spec) => (
              <Area
                key={spec.key}
                type="monotone"
                dataKey={spec.key}
                stroke={`var(--color-${spec.key})`}
                fill={`var(--color-${spec.key})`}
                fillOpacity={0.25}
                strokeWidth={2}
                stackId={stacked ? "stack" : undefined}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart {...shared}>
            {grid}
            {xAxis}
            {tooltip}
            {legend}
            {brush}
            {series.map((spec) => (
              <Line
                key={spec.key}
                type="monotone"
                dataKey={spec.key}
                stroke={`var(--color-${spec.key})`}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>
    </div>
  );
}

/* ---------------------------------- Stat ---------------------------------- */

function formatStatValue(
  raw: unknown,
  format: string,
  currency: string,
): string {
  const value = toNumber(raw);
  if (value === null) return toDisplayString(raw);
  try {
    if (format === "currency") {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
      }).format(value);
    }
    if (format === "percent") {
      return new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    }
    return new Intl.NumberFormat().format(value);
  } catch {
    return String(value);
  }
}

function formatDelta(delta: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "percent",
      maximumFractionDigits: 1,
      signDisplay: "always",
    }).format(delta);
  } catch {
    return `${delta > 0 ? "+" : ""}${Math.round(delta * 100)}%`;
  }
}

export function StatView({ component, base }: ViewProps) {
  const { dataModel } = useA2uiSurface();
  const label = resolveString(component.label, dataModel, base);
  const raw = resolveDynamic(component.value, dataModel, base);
  const format = toDisplayString(component.format) || "number";
  const currency = toDisplayString(component.currency) || "USD";
  const delta = toNumber(resolveDynamic(component.delta, dataModel, base));

  return (
    <div className="flex min-w-28 flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 shadow-xs">
      {label.length > 0 && (
        <span className="text-muted-foreground text-xs">{label}</span>
      )}
      <span className="font-semibold text-lg tabular-nums leading-tight">
        {formatStatValue(raw, format, currency)}
      </span>
      {delta !== null && (
        <span
          className={cn(
            "flex items-center gap-1 text-xs tabular-nums",
            delta >= 0
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400",
          )}
        >
          {delta >= 0 ? (
            <TrendingUp className="size-3" />
          ) : (
            <TrendingDown className="size-3" />
          )}
          {formatDelta(delta)}
        </span>
      )}
    </div>
  );
}

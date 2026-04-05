"use client";

import { useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle } from "@/lib/inflation";
import { MonthSelector } from "@/components/month-selector";
import {
  type EgresoRow,
  type ResultadoRow,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/economic-queries";
import type { ResumenMensualRow } from "@/lib/tax-queries";
import { useEgresosData } from "@/lib/use-egresos-data";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

type Granularity = "mensual" | "trimestral" | "anual";

const GRANULARITY_LABELS: Record<Granularity, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  anual: "Anual",
};

const QUARTER_LABELS: Record<string, string> = {
  "01": "Q1", "02": "Q1", "03": "Q1",
  "04": "Q2", "05": "Q2", "06": "Q2",
  "07": "Q3", "08": "Q3", "09": "Q3",
  "10": "Q4", "11": "Q4", "12": "Q4",
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface AggregatedRow {
  key: string;
  label: string;
  value: number;
  breakdown: Record<string, number>;
}

function aggregateRows(
  data: EgresoRow[],
  taxData: Map<string, ResumenMensualRow>,
  resultadoData: Map<string, ResultadoRow>,
  extractValue: (r: EgresoRow, tax?: ResumenMensualRow, resultado?: ResultadoRow) => number,
  extractBreakdown: ((r: EgresoRow, tax?: ResumenMensualRow, resultado?: ResultadoRow) => Record<string, number>) | undefined,
  granularity: Granularity,
  aggregateValue?: (rows: EgresoRow[]) => number,
): AggregatedRow[] {
  if (granularity === "mensual") {
    return [...data]
      .map((r) => {
        const tax = taxData.get(r.periodo);
        const res = resultadoData.get(r.periodo);
        return {
          key: r.periodo,
          label: periodoLabel(r.periodo),
          value: extractValue(r, tax, res),
          breakdown: extractBreakdown?.(r, tax, res) ?? {},
        };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  // Group rows into buckets for quarterly/annual aggregation
  const bucketRows = new Map<string, EgresoRow[]>();
  const buckets = new Map<string, AggregatedRow>();
  for (const r of data) {
    const [y, m] = r.periodo.split("-");
    const bucketKey = granularity === "trimestral" ? `${y}-${QUARTER_LABELS[m]}` : y;
    const tax = taxData.get(r.periodo);
    const res = resultadoData.get(r.periodo);
    const val = extractValue(r, tax, res);
    const bd = extractBreakdown?.(r, tax, res) ?? {};
    const cur = buckets.get(bucketKey);
    if (!cur) {
      buckets.set(bucketKey, {
        key: bucketKey,
        label: granularity === "trimestral" ? `${QUARTER_LABELS[m]} ${y}` : y,
        value: val,
        breakdown: { ...bd },
      });
      if (aggregateValue) bucketRows.set(bucketKey, [r]);
    } else {
      cur.value += val;
      for (const [k, v] of Object.entries(bd)) {
        cur.breakdown[k] = (cur.breakdown[k] ?? 0) + v;
      }
      if (aggregateValue) bucketRows.get(bucketKey)!.push(r);
    }
  }

  // When aggregateValue is provided, override the summed value with a recalculation
  if (aggregateValue) {
    Array.from(bucketRows.entries()).forEach(([key, rows]) => {
      buckets.get(key)!.value = aggregateValue(rows);
    });
  }

  return Array.from(buckets.values()).sort((a, b) => b.key.localeCompare(a.key));
}

// ---------------------------------------------------------------------------
// KPI Card (local)
// ---------------------------------------------------------------------------

function KpiCard({
  title,
  value,
  delta,
  color,
}: {
  title: string;
  value: number;
  delta: number | null;
  color?: string;
}) {
  const deltaPositive = delta !== null && delta < 0;
  const deltaNegative = delta !== null && delta > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatARS(value)}</div>
        {delta !== null ? (
          <p className={`text-xs ${deltaPositive ? "text-green-600" : deltaNegative ? "text-red-600" : "text-muted-foreground"}`}>
            {formatPct(delta)} vs mes anterior
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Sin mes anterior</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const DEFAULT_COLORS = [
  "#f59e0b", "#6366f1", "#ef4444", "#8b5cf6", "#ec4899",
  "#22c55e", "#06b6d4", "#f97316", "#14b8a6", "#a855f7",
];

export interface EgresoDetailPageProps {
  title: string;
  subtitle: string;
  extractValue: (row: EgresoRow, tax?: ResumenMensualRow, resultado?: ResultadoRow) => number;
  extractBreakdown?: (row: EgresoRow, tax?: ResumenMensualRow, resultado?: ResultadoRow) => Record<string, number>;
  breakdownColors?: Record<string, string>;
  /**
   * When provided, overrides sum-based aggregation for quarterly/annual views.
   * Receives all EgresoRows in the bucket and returns the aggregated value.
   * Used by Imp. a las Ganancias to recalculate on the summed base instead of
   * summing monthly clamped values (which inflates the annual effective rate).
   */
  aggregateValue?: (rows: EgresoRow[]) => number;
  /** Extra content rendered after the main sections (e.g. IVA section) */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EgresoDetailPage({
  title,
  subtitle,
  extractValue,
  extractBreakdown,
  breakdownColors,
  aggregateValue,
  children,
}: EgresoDetailPageProps) {
  const { data, taxData, resultadoData, loading, error, periodos } = useEgresosData();
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedPeriodo, setSelectedPeriodo] = useState("");

  const activePeriodo = selectedPeriodo || periodos[periodos.length - 1] || "";
  const selectedIdx = data.findIndex((r) => r.periodo === activePeriodo);
  const last = selectedIdx >= 0 ? data[selectedIdx] : data[data.length - 1];
  const prev = selectedIdx >= 1 ? data[selectedIdx - 1] : null;

  const lastValue = last ? extractValue(last, taxData.get(last.periodo), resultadoData.get(last.periodo)) : 0;
  const prevValue = prev ? extractValue(prev, taxData.get(prev.periodo), resultadoData.get(prev.periodo)) : null;

  // Discover breakdown keys sorted by total descending
  const breakdownKeys = useMemo(() => {
    if (!extractBreakdown) return [];
    const totals = new Map<string, number>();
    for (const r of data) {
      const bd = extractBreakdown(r, taxData.get(r.periodo), resultadoData.get(r.periodo));
      for (const [k, v] of Object.entries(bd)) {
        totals.set(k, (totals.get(k) ?? 0) + v);
      }
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [data, taxData, resultadoData, extractBreakdown]);

  // Chart data — last 12 months
  const chartData = useMemo(() => {
    const slice = data.slice(-12);
    if (extractBreakdown && breakdownKeys.length > 0) {
      return slice.map((r) => {
        const bd = extractBreakdown(r, taxData.get(r.periodo), resultadoData.get(r.periodo));
        const row: Record<string, string | number> = { label: shortLabel(r.periodo) };
        for (const k of breakdownKeys) {
          row[k] = bd[k] ?? 0;
        }
        return row;
      });
    }
    return slice.map((r) => ({
      label: shortLabel(r.periodo),
      [title]: extractValue(r, taxData.get(r.periodo), resultadoData.get(r.periodo)),
    }));
  }, [data, taxData, resultadoData, extractBreakdown, breakdownKeys, extractValue, title]);

  // Color map for breakdown bars
  const colorMap = useMemo(() => {
    if (breakdownColors) return breakdownColors;
    const map: Record<string, string> = {};
    breakdownKeys.forEach((k, i) => {
      map[k] = DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    });
    return map;
  }, [breakdownKeys, breakdownColors]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando datos...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <p className="text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Sin datos de egresos</p>
          <p className="text-sm text-muted-foreground">
            Ejecutá el ETL para importar facturas recibidas, sueldos, impuestos y movimientos bancarios.
          </p>
        </CardContent>
      </Card>
    );
  }

  const aggregated = aggregateRows(data, taxData, resultadoData, extractValue, extractBreakdown, granularity, aggregateValue);
  const hasBreakdown = extractBreakdown && breakdownKeys.length > 0;
  const chartKeys = hasBreakdown ? breakdownKeys : [title];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector periodos={periodos} value={activePeriodo} onChange={setSelectedPeriodo} />
          <InflationToggle />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          title={`Total ${title}`}
          value={lastValue}
          delta={prevValue !== null ? pctDelta(lastValue, prevValue) : null}
        />
        {hasBreakdown && breakdownKeys.slice(0, 5).map((k) => {
          const lastBd = last ? (extractBreakdown!(last, taxData.get(last.periodo), resultadoData.get(last.periodo))[k] ?? 0) : 0;
          const prevBd = prev ? (extractBreakdown!(prev, taxData.get(prev.periodo), resultadoData.get(prev.periodo))[k] ?? 0) : null;
          return (
            <KpiCard
              key={k}
              title={k}
              value={lastBd}
              delta={prevBd !== null ? pctDelta(lastBd, prevBd) : null}
              color={colorMap[k]}
            />
          );
        })}
      </div>

      {/* Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolución mensual — {title}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              {chartKeys.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  name={k}
                  stackId={hasBreakdown ? "a" : undefined}
                  fill={colorMap[k] ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                  radius={!hasBreakdown || i === chartKeys.length - 1 ? [4, 4, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Detalle {GRANULARITY_LABELS[granularity]}</CardTitle>
          <div className="flex items-center rounded-lg border text-xs font-medium">
            {(["mensual", "trimestral", "anual"] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 capitalize transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  granularity === g
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  {hasBreakdown &&
                    breakdownKeys.map((k) => (
                      <TableHead key={k} className="text-right">{k}</TableHead>
                    ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregated.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium whitespace-nowrap">{row.label}</TableCell>
                    {hasBreakdown &&
                      breakdownKeys.map((k) => (
                        <TableCell key={k} className="text-right">
                          {formatARS(row.breakdown[k] ?? 0)}
                        </TableCell>
                      ))}
                    <TableCell className="text-right font-medium">{formatARS(row.value)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Optional extra content (e.g. IVA section) */}
      {children}
    </div>
  );
}

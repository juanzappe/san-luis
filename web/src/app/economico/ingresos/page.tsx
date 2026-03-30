"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { DollarSign, Store, Coffee, Utensils, Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type IngresoRow,
  fetchIngresos,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/economic-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const COLORS = {
  mostrador: "#8b5cf6",
  restobar: "#06b6d4",
  servicios: "#22c55e",
};

const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const YEAR_COLORS: Record<string, string> = {
  "2024": "#94a3b8",
  "2025": "#3b82f6",
  "2026": "#8b5cf6",
};

type ViewMode = "mensual" | "trimestral" | "anual";

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------
function KpiCard({
  title,
  value,
  delta,
  icon: Icon,
}: {
  title: string;
  value: number;
  delta: number | null;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatARS(value)}</div>
        {delta !== null ? (
          <p className={`text-xs ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
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
// Year-over-year comparison chart for a single business unit
// ---------------------------------------------------------------------------
function YoYChart({ data, dataKey, title, color }: {
  data: IngresoRow[];
  dataKey: keyof Omit<IngresoRow, "periodo">;
  title: string;
  color: string;
}) {
  // Group by year → month
  const years = useMemo(() => {
    const yearSet = new Set<string>();
    data.forEach((r) => yearSet.add(r.periodo.slice(0, 4)));
    return Array.from(yearSet).sort();
  }, [data]);

  const chartData = useMemo(() => {
    return SHORT_MONTHS.map((label, i) => {
      const monthNum = String(i + 1).padStart(2, "0");
      const row: Record<string, string | number> = { label };
      for (const y of years) {
        const match = data.find((r) => r.periodo === `${y}-${monthNum}`);
        row[y] = match ? match[dataKey] : 0;
      }
      return row;
    });
  }, [data, years, dataKey]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
            <Tooltip formatter={arsTooltip} />
            <Legend />
            {years.map((y) => (
              <Bar
                key={y}
                dataKey={y}
                name={y}
                fill={YEAR_COLORS[y] ?? color}
                radius={[2, 2, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers for aggregation
// ---------------------------------------------------------------------------
function quarterLabel(periodo: string): string {
  const [y, m] = periodo.split("-");
  const q = Math.ceil(parseInt(m) / 3);
  return `Q${q} ${y}`;
}

function aggregateQuarterly(rows: IngresoRow[]): IngresoRow[] {
  const map = new Map<string, IngresoRow>();
  for (const r of rows) {
    const key = quarterLabel(r.periodo);
    const existing = map.get(key);
    if (existing) {
      existing.mostrador += r.mostrador;
      existing.restobar += r.restobar;
      existing.servicios += r.servicios;
      existing.total += r.total;
    } else {
      map.set(key, { periodo: key, mostrador: r.mostrador, restobar: r.restobar, servicios: r.servicios, total: r.total });
    }
  }
  return Array.from(map.values());
}

function aggregateAnnual(rows: IngresoRow[]): IngresoRow[] {
  const map = new Map<string, IngresoRow>();
  for (const r of rows) {
    const year = r.periodo.slice(0, 4);
    const existing = map.get(year);
    if (existing) {
      existing.mostrador += r.mostrador;
      existing.restobar += r.restobar;
      existing.servicios += r.servicios;
      existing.total += r.total;
    } else {
      map.set(year, { periodo: year, mostrador: r.mostrador, restobar: r.restobar, servicios: r.servicios, total: r.total });
    }
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function IngresosPage() {
  const { adjust } = useInflation();
  const [raw, setRaw] = useState<IngresoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [yearFilter, setYearFilter] = useState("Todos");
  const [viewMode, setViewMode] = useState<ViewMode>("mensual");

  useEffect(() => {
    fetchIngresos()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Available years
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    raw.forEach((r) => years.add(r.periodo.slice(0, 4)));
    return Array.from(years).sort();
  }, [raw]);

  // Apply inflation adjustment
  const allData: IngresoRow[] = useMemo(() =>
    raw.map((r) => ({
      periodo: r.periodo,
      mostrador: adjust(r.mostrador, r.periodo),
      restobar: adjust(r.restobar, r.periodo),
      servicios: adjust(r.servicios, r.periodo),
      total: adjust(r.total, r.periodo),
    })),
  [raw, adjust]);

  // Filtered by year
  const filteredData = useMemo(() => {
    if (yearFilter === "Todos") return allData;
    return allData.filter((r) => r.periodo.startsWith(yearFilter));
  }, [allData, yearFilter]);

  // View-aggregated data for table
  const tableData = useMemo(() => {
    if (viewMode === "trimestral") return aggregateQuarterly(filteredData);
    if (viewMode === "anual") return aggregateAnnual(filteredData);
    return filteredData;
  }, [filteredData, viewMode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando datos…</span>
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

  if (raw.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Sin datos de ingresos</p>
          <p className="text-sm text-muted-foreground">
            Ejecutá el ETL para importar ventas y facturas emitidas.
          </p>
        </CardContent>
      </Card>
    );
  }

  const last = allData[allData.length - 1];
  const prev = allData.length >= 2 ? allData[allData.length - 2] : null;

  // Last 12 months for stacked bar chart
  const chartData = allData.slice(-12).map((r) => ({
    ...r,
    label: shortLabel(r.periodo),
  }));

  // Annual variation for annual view
  const annualRows = viewMode === "anual" ? aggregateAnnual(filteredData) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ingresos</h1>
          <p className="text-muted-foreground">
            Ingresos por unidad de negocio — {periodoLabel(last.periodo)}
          </p>
        </div>
        <InflationToggle />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Total Ingresos"
          value={last.total}
          delta={prev ? pctDelta(last.total, prev.total) : null}
          icon={DollarSign}
        />
        <KpiCard
          title="Mostrador"
          value={last.mostrador}
          delta={prev ? pctDelta(last.mostrador, prev.mostrador) : null}
          icon={Store}
        />
        <KpiCard
          title="Restobar"
          value={last.restobar}
          delta={prev ? pctDelta(last.restobar, prev.restobar) : null}
          icon={Coffee}
        />
        <KpiCard
          title="Servicios"
          value={last.servicios}
          delta={prev ? pctDelta(last.servicios, prev.servicios) : null}
          icon={Utensils}
        />
      </div>

      {/* Stacked bar chart (last 12 months) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingresos por Unidad de Negocio</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              <Bar dataKey="mostrador" name="Mostrador" stackId="a" fill={COLORS.mostrador} />
              <Bar dataKey="restobar" name="Restobar" stackId="a" fill={COLORS.restobar} />
              <Bar dataKey="servicios" name="Servicios" stackId="a" fill={COLORS.servicios} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Year-over-year comparison charts (3 charts) */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <YoYChart data={allData} dataKey="mostrador" title="Mostrador — Comparación Anual" color={COLORS.mostrador} />
        <YoYChart data={allData} dataKey="restobar" title="Restobar — Comparación Anual" color={COLORS.restobar} />
        <YoYChart data={allData} dataKey="servicios" title="Servicios — Comparación Anual" color={COLORS.servicios} />
      </div>

      {/* Controls: Year filter + View toggle */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Year filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Año:</span>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="Todos">Todos</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* View mode toggle */}
        <div className="flex rounded-md border border-input shadow-sm">
          {(["mensual", "trimestral", "anual"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors first:rounded-l-md last:rounded-r-md ${
                viewMode === mode
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Detail table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Detalle {viewMode === "mensual" ? "Mensual" : viewMode === "trimestral" ? "Trimestral" : "Anual"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{viewMode === "anual" ? "Año" : "Período"}</TableHead>
                <TableHead className="text-right">Mostrador</TableHead>
                <TableHead className="text-right">Restobar</TableHead>
                <TableHead className="text-right">Servicios</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {viewMode === "anual" && <TableHead className="text-right">Var. %</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...(viewMode === "anual" ? annualRows : tableData)].reverse().map((row, idx, arr) => {
                const prevRow = idx + 1 < arr.length ? arr[idx + 1] : null;
                const varPct = prevRow && prevRow.total > 0
                  ? ((row.total - prevRow.total) / prevRow.total) * 100
                  : null;

                return (
                  <TableRow key={row.periodo}>
                    <TableCell className="font-medium">
                      {viewMode === "mensual" ? periodoLabel(row.periodo) : row.periodo}
                    </TableCell>
                    <TableCell className="text-right">{formatARS(row.mostrador)}</TableCell>
                    <TableCell className="text-right">{formatARS(row.restobar)}</TableCell>
                    <TableCell className="text-right">{formatARS(row.servicios)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(row.total)}</TableCell>
                    {viewMode === "anual" && (
                      <TableCell className={`text-right ${varPct !== null && varPct >= 0 ? "text-green-600" : varPct !== null ? "text-red-600" : ""}`}>
                        {varPct !== null ? `${varPct >= 0 ? "+" : ""}${varPct.toFixed(1)}%` : "—"}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

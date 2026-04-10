"use client";

import React, { useMemo, useState } from "react";
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
import {
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import { MonthSelector } from "@/components/month-selector";
import {
  type EgresoRow,
  TASA_GANANCIAS,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/economic-queries";
import { useEgresosData } from "@/lib/use-egresos-data";
import { computeGastosComerciales } from "@/lib/tax-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

// Fixed colors for the KPI categories
const OPERATIVOS_COLOR = "#f59e0b";
const SUELDOS_COLOR = "#6366f1";
const COMERCIALES_COLOR = "#ef4444";
const FINANCIEROS_COLOR = "#8b5cf6";
const GANANCIAS_COLOR = "#ec4899";

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

const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

interface AggregatedEgreso {
  key: string;
  label: string;
  categorias: Record<string, number>;
  sueldos: number;
  comerciales: number; // gastos comerciales devengado (IIBB + Seg. e Hig. + municipales)
  ganancias: number;
  gananciasBase: number; // pre-clamp base for correct annual recalculation
  financieros: number;
  total: number;
}

function aggregateEgresos(data: AggregatedEgreso[], granularity: Granularity): AggregatedEgreso[] {
  if (granularity === "mensual") {
    return [...data].sort((a, b) => b.key.localeCompare(a.key));
  }

  const buckets = new Map<string, AggregatedEgreso>();
  for (const r of data) {
    const [y, m] = r.key.split("-");
    const bucketKey = granularity === "trimestral" ? `${y}-${QUARTER_LABELS[m]}` : y;
    const cur = buckets.get(bucketKey) ?? {
      key: bucketKey,
      label: granularity === "trimestral" ? `${QUARTER_LABELS[m]} ${y}` : y,
      categorias: {},
      sueldos: 0,
      comerciales: 0,
      ganancias: 0,
      gananciasBase: 0,
      financieros: 0,
      total: 0,
    };
    for (const [cat, monto] of Object.entries(r.categorias)) {
      cur.categorias[cat] = (cur.categorias[cat] ?? 0) + monto;
    }
    cur.sueldos += r.sueldos;
    cur.comerciales += r.comerciales;
    cur.ganancias += r.ganancias;
    cur.gananciasBase += r.gananciasBase;
    cur.financieros += r.financieros;
    cur.total += r.total;
    buckets.set(bucketKey, cur);
  }

  // Recalculate ganancias on aggregated base (monthly clamp-at-0 inflates annual rate)
  Array.from(buckets.values()).forEach((cur) => {
    const oldGan = cur.ganancias;
    cur.ganancias = cur.gananciasBase > 0 ? cur.gananciasBase * TASA_GANANCIAS : 0;
    cur.total += cur.ganancias - oldGan;
  });

  return Array.from(buckets.values()).sort((a, b) => b.key.localeCompare(a.key));
}

// ---------------------------------------------------------------------------
// YTD Comparison — multi-year (egresos)
// ---------------------------------------------------------------------------
interface EgresosYtdYearData {
  year: string;
  costosOperativos: number;
  sueldos: number;
  comerciales: number;
  ganancias: number;
  financieros: number;
  total: number;
}

function useEgresosYtdData(rows: AggregatedEgreso[]): { monthRange: string; years: EgresosYtdYearData[] } | null {
  return useMemo(() => {
    if (rows.length === 0) return null;

    const allYears = Array.from(new Set(rows.map((r) => r.key.slice(0, 4)))).sort();
    if (allYears.length === 0) return null;

    const currentYear = allYears[allYears.length - 1];

    // Months with data in the most recent year — defines the YTD range
    const currentMonths = rows
      .filter((r) => r.key.startsWith(currentYear))
      .map((r) => r.key.slice(5, 7))
      .sort();

    if (currentMonths.length === 0) return null;

    const firstMonth = currentMonths[0];
    const lastMonth = currentMonths[currentMonths.length - 1];
    const monthRange = `${MONTH_NAMES[parseInt(firstMonth, 10) - 1]}–${MONTH_NAMES[parseInt(lastMonth, 10) - 1]}`;

    // Accumulate same months for every year
    const years: EgresosYtdYearData[] = [];
    for (const y of [...allYears].reverse()) {
      const acc: EgresosYtdYearData = { year: y, costosOperativos: 0, sueldos: 0, comerciales: 0, ganancias: 0, financieros: 0, total: 0 };
      let hasData = false;
      for (const m of currentMonths) {
        const match = rows.find((r) => r.key === `${y}-${m}`);
        if (match) {
          hasData = true;
          acc.costosOperativos += Object.values(match.categorias).reduce((a, b) => a + b, 0);
          acc.sueldos += match.sueldos;
          acc.comerciales += match.comerciales;
          acc.ganancias += match.ganancias;
          acc.financieros += match.financieros;
          acc.total += match.total;
        }
      }
      if (hasData) years.push(acc);
    }

    return years.length >= 2 ? { monthRange, years } : null;
  }, [rows]);
}

function EgresosYtdTable({ rows }: { rows: AggregatedEgreso[] }) {
  const ytd = useEgresosYtdData(rows);
  if (!ytd) return null;

  const { monthRange, years } = ytd;

  const cats: { label: string; key: keyof Omit<EgresosYtdYearData, "year">; bold: boolean }[] = [
    { label: "Costos Operativos", key: "costosOperativos", bold: false },
    { label: "Sueldos y CS", key: "sueldos", bold: false },
    { label: "Gastos Comerciales", key: "comerciales", bold: false },
    { label: "Imp. Ganancias", key: "ganancias", bold: false },
    { label: "Financieros", key: "financieros", bold: false },
    { label: "Total", key: "total", bold: true },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Comparación YTD ({monthRange})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                {years.map((y, i) => (
                  <React.Fragment key={y.year}>
                    <TableHead className="text-right">{monthRange} {y.year}</TableHead>
                    {i < years.length - 1 && (
                      <TableHead className="text-right text-xs">Δ %</TableHead>
                    )}
                  </React.Fragment>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {cats.map((c) => (
                <TableRow key={c.key}>
                  <TableCell className={c.bold ? "font-bold" : ""}>{c.label}</TableCell>
                  {years.map((y, i) => {
                    const val = y[c.key];
                    const next = i < years.length - 1 ? years[i + 1] : null;
                    const delta = next && next[c.key] > 0 ? pctDelta(val, next[c.key]) : null;
                    return (
                      <React.Fragment key={y.year}>
                        <TableCell className={`text-right ${c.bold ? "font-bold" : ""} ${i > 0 ? "text-muted-foreground" : ""}`}>
                          {formatARS(val)}
                        </TableCell>
                        {i < years.length - 1 && (
                          <TableCell className={`text-right font-medium ${delta !== null && delta <= 0 ? "text-green-600" : "text-red-600"}`}>
                            {delta !== null ? formatPct(delta) : "—"}
                          </TableCell>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Monthly average by year (egresos)
// ---------------------------------------------------------------------------
interface EgresoYearAvg {
  year: string;
  costosOperativos: number;
  sueldos: number;
  comerciales: number;
  ganancias: number;
  financieros: number;
  total: number;
  months: number;
}

function EgresosMonthlyAverageByYear({ rows }: { rows: AggregatedEgreso[] }) {
  const avgRows = useMemo(() => {
    const byYear = new Map<string, { costosOperativos: number; sueldos: number; comerciales: number; ganancias: number; financieros: number; total: number; months: number }>();
    for (const r of rows) {
      const y = r.key.slice(0, 4);
      const cur = byYear.get(y) ?? { costosOperativos: 0, sueldos: 0, comerciales: 0, ganancias: 0, financieros: 0, total: 0, months: 0 };
      cur.costosOperativos += Object.values(r.categorias).reduce((a, b) => a + b, 0);
      cur.sueldos += r.sueldos;
      cur.comerciales += r.comerciales;
      cur.ganancias += r.ganancias;
      cur.financieros += r.financieros;
      cur.total += r.total;
      cur.months += 1;
      byYear.set(y, cur);
    }

    const result: EgresoYearAvg[] = Array.from(byYear.entries())
      .map(([year, v]) => ({
        year,
        costosOperativos: v.costosOperativos / v.months,
        sueldos: v.sueldos / v.months,
        comerciales: v.comerciales / v.months,
        ganancias: v.ganancias / v.months,
        financieros: v.financieros / v.months,
        total: v.total / v.months,
        months: v.months,
      }))
      .sort((a, b) => b.year.localeCompare(a.year));

    return result;
  }, [rows]);

  if (avgRows.length === 0) return null;

  const monthsNote = avgRows.map((r) => `${r.year}: ${r.months} ${r.months === 1 ? "mes" : "meses"}`).join(" · ");

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Promedio Mensual por Año</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Año</TableHead>
              <TableHead className="text-right">Costos Operativos</TableHead>
              <TableHead className="text-right">Sueldos y CS</TableHead>
              <TableHead className="text-right">Gastos Comerciales</TableHead>
              <TableHead className="text-right">Imp. Ganancias</TableHead>
              <TableHead className="text-right">Financieros</TableHead>
              <TableHead className="text-right font-bold">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {avgRows.map((r) => (
              <TableRow key={r.year}>
                <TableCell className="font-medium">{r.year}</TableCell>
                <TableCell className="text-right">{formatARS(r.costosOperativos)}</TableCell>
                <TableCell className="text-right">{formatARS(r.sueldos)}</TableCell>
                <TableCell className="text-right">{formatARS(r.comerciales)}</TableCell>
                <TableCell className="text-right">{formatARS(r.ganancias)}</TableCell>
                <TableCell className="text-right">{formatARS(r.financieros)}</TableCell>
                <TableCell className="text-right font-bold">{formatARS(r.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Basado en {monthsNote}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// KPI Card
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
// Main
// ---------------------------------------------------------------------------
export default function EgresosPage() {
  const { adjust } = useInflation();
  const { data, resultadoData, loading, error, periodos } = useEgresosData();
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedPeriodo, setSelectedPeriodo] = useState("");

  // Discover all category names sorted by total descending
  const allCategories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of data) {
      for (const [cat, monto] of Object.entries(r.categorias)) {
        totals.set(cat, (totals.get(cat) ?? 0) + monto);
      }
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [data]);

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

  const activePeriodo = selectedPeriodo || periodos[periodos.length - 1] || "";
  const selectedIdx = data.findIndex((r) => r.periodo === activePeriodo);
  const last = selectedIdx >= 0 ? data[selectedIdx] : data[data.length - 1];
  const prev = selectedIdx >= 1 ? data[selectedIdx - 1] : null;

  // Costos Operativos = sum of all categorias (factura_recibida by provider)
  const costosOp = (r: EgresoRow) =>
    Object.values(r.categorias).reduce((a, b) => a + b, 0);
  const lastCostosOp = costosOp(last);
  const prevCostosOp = prev ? costosOp(prev) : null;

  // Gastos Comerciales devengado: 5.5% of ingresos netos + cuotas fijas
  // Uses the same ingresos base as the P&L (ResultadoRow.ingresos)
  const gastosComerciales = (r: EgresoRow) => {
    const ingresos = resultadoData.get(r.periodo)?.ingresos ?? 0;
    return adjust(computeGastosComerciales(ingresos, r.periodo), r.periodo);
  };

  // Total = components sum (avoids the percibido comerciales from RPC)
  const totalEgresos = (r: EgresoRow) => {
    const ops = Object.values(r.categorias).reduce((a, b) => a + b, 0);
    const sueldos = r.sueldosNeto + r.cargasSociales;
    return ops + sueldos + gastosComerciales(r) + r.ganancias + r.financieros;
  };

  // Build aggregated rows (with IVA subtracted) for chart + table
  const rowsForAgg: AggregatedEgreso[] = data.map((r) => ({
    key: r.periodo,
    label: periodoLabel(r.periodo),
    categorias: r.categorias,
    sueldos: r.sueldosNeto + r.cargasSociales,
    comerciales: gastosComerciales(r),
    ganancias: r.ganancias,
    gananciasBase: r.gananciasBase,
    financieros: r.financieros,
    total: totalEgresos(r),
  }));

  // Chart data — 5 stacked categories
  const chartData = data.slice(-12).map((r) => ({
    label: shortLabel(r.periodo),
    "Costos Operativos": costosOp(r),
    "Sueldos": r.sueldosNeto + r.cargasSociales,
    "Gastos Comerciales": gastosComerciales(r),
    "Imp. Ganancias": r.ganancias,
    "Financieros": r.financieros,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Egresos</h1>
          <p className="text-muted-foreground">Estructura de costos por categoría</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector periodos={periodos} value={activePeriodo} onChange={setSelectedPeriodo} />
          <InflationToggle />
        </div>
      </div>

      {/* KPI Cards — 6 categories */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <KpiCard
          title="Total Egresos"
          value={totalEgresos(last)}
          delta={prev ? pctDelta(totalEgresos(last), totalEgresos(prev)) : null}
        />
        <KpiCard
          title="Costos Operativos"
          value={lastCostosOp}
          delta={prevCostosOp !== null ? pctDelta(lastCostosOp, prevCostosOp) : null}
          color={OPERATIVOS_COLOR}
        />
        <KpiCard
          title="Sueldos y CS"
          value={last.sueldosNeto + last.cargasSociales}
          delta={prev ? pctDelta(last.sueldosNeto + last.cargasSociales, prev.sueldosNeto + prev.cargasSociales) : null}
          color={SUELDOS_COLOR}
        />
        <KpiCard
          title="Gastos Comerciales"
          value={gastosComerciales(last)}
          delta={prev ? pctDelta(gastosComerciales(last), gastosComerciales(prev)) : null}
          color={COMERCIALES_COLOR}
        />
        <KpiCard
          title="Imp. Ganancias"
          value={last.ganancias}
          delta={prev && prev.ganancias > 0 ? pctDelta(last.ganancias, prev.ganancias) : null}
          color={GANANCIAS_COLOR}
        />
        <KpiCard
          title="Financieros"
          value={last.financieros}
          delta={prev ? pctDelta(last.financieros, prev.financieros) : null}
          color={FINANCIEROS_COLOR}
        />
      </div>

      {/* YTD Comparison Table */}
      <EgresosYtdTable rows={rowsForAgg} />

      {/* Monthly average by year */}
      <EgresosMonthlyAverageByYear rows={rowsForAgg} />

      {/* Stacked bar chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Composición de Egresos por Categoría</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              <Bar dataKey="Costos Operativos" name="Costos Operativos" stackId="a" fill={OPERATIVOS_COLOR} />
              <Bar dataKey="Sueldos" name="Sueldos" stackId="a" fill={SUELDOS_COLOR} />
              <Bar dataKey="Gastos Comerciales" name="Gastos Comerciales" stackId="a" fill={COMERCIALES_COLOR} />
              <Bar dataKey="Imp. Ganancias" name="Imp. Ganancias" stackId="a" fill={GANANCIAS_COLOR} />
              <Bar dataKey="Financieros" name="Financieros" stackId="a" fill={FINANCIEROS_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detail table with period selector */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Detalle {GRANULARITY_LABELS[granularity]} por Categoría</CardTitle>
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
                  {allCategories.map((cat) => (
                    <TableHead key={cat} className="text-right">{cat}</TableHead>
                  ))}
                  <TableHead className="text-right">Sueldos y CS</TableHead>
                  <TableHead className="text-right">Gastos Comerciales</TableHead>
                  <TableHead className="text-right">Imp. Ganancias</TableHead>
                  <TableHead className="text-right">Financieros</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregateEgresos(rowsForAgg, granularity).map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium whitespace-nowrap">{row.label}</TableCell>
                    {allCategories.map((cat) => (
                      <TableCell key={cat} className="text-right">
                        {formatARS(row.categorias[cat] ?? 0)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">{formatARS(row.sueldos)}</TableCell>
                    <TableCell className="text-right">{formatARS(row.comerciales)}</TableCell>
                    <TableCell className={`text-right ${row.ganancias === 0 ? "text-muted-foreground" : ""}`}>
                      {row.ganancias > 0 ? formatARS(row.ganancias) : "—"}
                    </TableCell>
                    <TableCell className="text-right">{formatARS(row.financieros)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

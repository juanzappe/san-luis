"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  Area,
  Cell,
  ReferenceLine,
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
import { Callout } from "@/components/callout";
import { MonthSelector } from "@/components/month-selector";
import {
  type EgresoRow,
  type ResultadoRow,
  COMERCIALES_PROVEEDOR_CATS,
  COSTOS_OPERATIVOS_ORDER,
  TASA_GANANCIAS,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/economic-queries";
import { useEgresosData } from "@/lib/use-egresos-data";
import { computeGastosComerciales } from "@/lib/tax-queries";
import {
  type YtdCutoff,
  type EgresoParcial,
  fetchFechaCorteYtd,
  fetchEgresosMesParcial,
  ytdMonthRangeLabel,
} from "@/lib/ytd-cutoff";
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

function useEgresosYtdData(
  rows: AggregatedEgreso[],
  cutoff: YtdCutoff | null,
  egresoPartial: Map<string, EgresoParcial>,
): { monthRange: string; years: EgresosYtdYearData[]; hasPartialCutoff: boolean } | null {
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
    const needsCutoff = cutoff && !cutoff.esFindeMes && egresoPartial.size > 0;
    const monthRange = ytdMonthRangeLabel(firstMonth, lastMonth, cutoff);

    // Accumulate same months for every year
    const years: EgresosYtdYearData[] = [];
    for (const y of [...allYears].reverse()) {
      const acc: EgresosYtdYearData = { year: y, costosOperativos: 0, sueldos: 0, comerciales: 0, ganancias: 0, financieros: 0, total: 0 };
      let hasData = false;
      for (const m of currentMonths) {
        const periodo = `${y}-${m}`;
        const isCutoffMonth = needsCutoff && m === lastMonth;
        const match = rows.find((r) => r.key === periodo);

        if (match) {
          hasData = true;
          // Costos Operativos = categorias salvo las que pasan a Comerciales
          const opsSum = Object.entries(match.categorias)
            .filter(([cat]) => !(COMERCIALES_PROVEEDOR_CATS as readonly string[]).includes(cat))
            .reduce((a, [, v]) => a + v, 0);
          if (isCutoffMonth) {
            // Day cutoff: proveedores + financieros use partial data
            // Sueldos, comerciales, ganancias: full month (monthly concepts)
            const ep = egresoPartial.get(periodo);
            acc.costosOperativos += ep ? ep.proveedores : opsSum;
            acc.financieros += ep ? ep.financieros : match.financieros;
          } else {
            acc.costosOperativos += opsSum;
            acc.financieros += match.financieros;
          }
          // These are always full month (monthly concepts or derived)
          acc.sueldos += match.sueldos;
          acc.comerciales += match.comerciales;
          acc.ganancias += match.ganancias;
        }
      }
      acc.total = acc.costosOperativos + acc.sueldos + acc.comerciales + acc.ganancias + acc.financieros;
      if (hasData) years.push(acc);
    }

    return years.length >= 2 ? { monthRange, years, hasPartialCutoff: !!needsCutoff } : null;
  }, [rows, cutoff, egresoPartial]);
}

function EgresosYtdTable({ rows, cutoff, egresoPartial }: {
  rows: AggregatedEgreso[];
  cutoff: YtdCutoff | null;
  egresoPartial: Map<string, EgresoParcial>;
}) {
  const ytd = useEgresosYtdData(rows, cutoff, egresoPartial);
  if (!ytd) return null;

  const { monthRange, years, hasPartialCutoff } = ytd;

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
                <TableHead className="sticky left-0 z-20 bg-card" />
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
                  <TableCell className={`sticky left-0 z-10 bg-card ${c.bold ? "font-bold" : ""}`}>{c.label}</TableCell>
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
        {hasPartialCutoff && (
          <p className="mt-3 text-xs text-muted-foreground">
            * Sueldos, cargas sociales, gastos comerciales e impuestos se comparan por mes completo.
          </p>
        )}
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
      cur.costosOperativos += Object.entries(r.categorias)
        .filter(([cat]) => !(COMERCIALES_PROVEEDOR_CATS as readonly string[]).includes(cat))
        .reduce((a, [, v]) => a + v, 0);
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
              <TableHead className="sticky left-0 z-20 bg-card">Año</TableHead>
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
                <TableCell className="sticky left-0 z-10 bg-card font-medium">{r.year}</TableCell>
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
// Chart: Ingresos vs Egresos por mes (último 24)
// ---------------------------------------------------------------------------
function IngresosVsEgresosChart({
  rows,
  resultadoData,
}: {
  rows: AggregatedEgreso[];
  resultadoData: Map<string, ResultadoRow>;
}) {
  const { adjust } = useInflation();
  const chartData = useMemo(() => {
    // Últimos 24 meses con datos. Ingresos se toman de resultadoData (crudo)
    // y se ajustan por inflación acá — los egresos ya vienen ajustados en
    // rows (vía adjust dentro de useEgresosData/totalEgresos).
    return rows
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-24)
      .map((r) => {
        const ingRaw = resultadoData.get(r.key)?.ingresos ?? 0;
        const ing = adjust(ingRaw, r.key);
        return {
          label: shortLabel(r.key),
          ingresos: ing,
          egresos: r.total,
          resultado: ing - r.total,
        };
      });
  }, [rows, resultadoData, adjust]);

  if (chartData.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ingresos vs Egresos</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" fontSize={12} />
            <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
            <Tooltip formatter={arsTooltip} />
            <Legend />
            <ReferenceLine y={0} stroke="#666" />
            <Area type="monotone" dataKey="resultado" name="Resultado (ing − egr)" fill="#22c55e" fillOpacity={0.2} stroke="none" />
            <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="egresos" name="Egresos" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-muted-foreground">
          Dos líneas de ingresos vs egresos totales, últimos 24 meses. El área verde representa el margen operativo antes de impuestos (ingresos − egresos). Si cruza bajo cero, ese mes hubo pérdida.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart: Waterfall del mes seleccionado (ingresos → resultado neto)
// ---------------------------------------------------------------------------
interface WaterfallBar {
  name: string;
  base: number;
  value: number;
  color: string;
  total?: boolean;
}

function buildMonthWaterfall(
  ingresos: number,
  costosOp: number,
  sueldos: number,
  comerciales: number,
  ganancias: number,
  financieros: number,
): WaterfallBar[] {
  const bars: WaterfallBar[] = [];
  let running = ingresos;
  bars.push({ name: "Ingresos", base: 0, value: ingresos, color: "#22c55e", total: true });
  bars.push({ name: "C. Operativos", base: running - costosOp, value: costosOp, color: OPERATIVOS_COLOR });
  running -= costosOp;
  bars.push({ name: "Sueldos y CS", base: running - sueldos, value: sueldos, color: SUELDOS_COLOR });
  running -= sueldos;
  bars.push({ name: "Margen Bruto", base: 0, value: running, color: running >= 0 ? "#22c55e" : "#ef4444", total: true });
  bars.push({ name: "Gastos Com.", base: running - comerciales, value: comerciales, color: COMERCIALES_COLOR });
  running -= comerciales;
  bars.push({ name: "Financieros", base: running - financieros, value: financieros, color: FINANCIEROS_COLOR });
  running -= financieros;
  bars.push({ name: "Imp. Ganancias", base: running - ganancias, value: ganancias, color: GANANCIAS_COLOR });
  running -= ganancias;
  bars.push({ name: "Resultado", base: 0, value: running, color: running >= 0 ? "#22c55e" : "#ef4444", total: true });
  return bars;
}

function WaterfallChart({
  periodo,
  ingresos,
  costosOp,
  sueldos,
  comerciales,
  ganancias,
  financieros,
}: {
  periodo: string;
  ingresos: number;
  costosOp: number;
  sueldos: number;
  comerciales: number;
  ganancias: number;
  financieros: number;
}) {
  const bars = useMemo(
    () => buildMonthWaterfall(ingresos, costosOp, sueldos, comerciales, ganancias, financieros),
    [ingresos, costosOp, sueldos, comerciales, ganancias, financieros],
  );

  if (ingresos === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cascada — {periodoLabel(periodo)}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={bars} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" fontSize={11} />
            <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
            <Tooltip formatter={arsTooltip} />
            <ReferenceLine y={0} stroke="#666" />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="value" stackId="w" radius={[4, 4, 0, 0]}>
              {bars.map((b, i) => (
                <Cell key={i} fill={b.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-muted-foreground">
          De Ingresos a Resultado Neto del mes: cada barra roja/naranja/morada deduce la categoría correspondiente. Los subtotales (Margen Bruto, Resultado) arrancan desde 0 para que se vea el acumulado.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart: Estructura de costos % sobre ingresos (evolutivo)
// ---------------------------------------------------------------------------
function EstructuraCostosPct({
  rows,
  resultadoData,
}: {
  rows: AggregatedEgreso[];
  resultadoData: Map<string, ResultadoRow>;
}) {
  const { adjust } = useInflation();
  const chartData = useMemo(() => {
    return rows
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-24)
      .map((r) => {
        const ingRaw = resultadoData.get(r.key)?.ingresos ?? 0;
        const ing = adjust(ingRaw, r.key);
        const costosOp = Object.entries(r.categorias)
          .filter(([cat]) => !(COMERCIALES_PROVEEDOR_CATS as readonly string[]).includes(cat))
          .reduce((a, [, v]) => a + v, 0);
        const pct = (val: number) => (ing > 0 ? (val / ing) * 100 : 0);
        return {
          label: shortLabel(r.key),
          Operativos: pct(costosOp),
          Sueldos: pct(r.sueldos),
          Comerciales: pct(r.comerciales),
          Ganancias: pct(r.ganancias),
          Financieros: pct(r.financieros),
        };
      });
  }, [rows, resultadoData, adjust]);

  if (chartData.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Estructura de Costos como % de Ingresos</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="label" fontSize={12} />
            <YAxis fontSize={12} tickFormatter={(v) => `${v.toFixed(0)}%`} />
            <Tooltip formatter={((v: ValueType | undefined) => `${Number(v ?? 0).toFixed(1)}%`) as Formatter<ValueType, NameType>} />
            <Legend />
            <Line type="monotone" dataKey="Operativos"   stroke={OPERATIVOS_COLOR}  strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            <Line type="monotone" dataKey="Sueldos"      stroke={SUELDOS_COLOR}     strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            <Line type="monotone" dataKey="Comerciales"  stroke={COMERCIALES_COLOR} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            <Line type="monotone" dataKey="Ganancias"    stroke={GANANCIAS_COLOR}   strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
            <Line type="monotone" dataKey="Financieros"  stroke={FINANCIEROS_COLOR} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-muted-foreground">
          Cada categoría de egreso como % de los ingresos del mismo mes. Detecta shifts estructurales: si Sueldos subió del 30 al 40% de ingresos mientras el resto se mantiene, hay un problema de escala del personal.
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
  deltaYoY,
  color,
}: {
  title: string;
  value: number;
  delta: number | null;
  deltaYoY?: number | null;
  color?: string;
}) {
  // Gastos: bajar es bueno → invertimos los colores
  const colorFor = (d: number | null) => {
    if (d === null) return "text-muted-foreground";
    return d < 0 ? "text-green-600" : d > 0 ? "text-red-600" : "text-muted-foreground";
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatARS(value)}</div>
        {delta !== null ? (
          <p className={`text-xs ${colorFor(delta)}`}>
            {formatPct(delta)} vs mes anterior
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Sin mes anterior</p>
        )}
        {deltaYoY !== undefined && deltaYoY !== null && (
          <p className={`text-xs ${colorFor(deltaYoY)}`}>
            {formatPct(deltaYoY)} vs mismo mes año anterior
          </p>
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
  const { data, taxData, resultadoData, loading, error, periodos } = useEgresosData();
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedPeriodo, setSelectedPeriodo] = useState("");
  const [ytdCutoff, setYtdCutoff] = useState<YtdCutoff | null>(null);
  const [ytdEgresoPartialRaw, setYtdEgresoPartialRaw] = useState<Map<string, EgresoParcial>>(new Map());

  useEffect(() => {
    fetchFechaCorteYtd().then((c) => {
      if (!c) return;
      setYtdCutoff(c);
      if (!c.esFindeMes) {
        fetchEgresosMesParcial(c.mes, c.dia).then(setYtdEgresoPartialRaw);
      }
    });
  }, []);

  // Inflation-adjusted partial egresos data for YTD cutoff
  const ytdEgresoPartial = useMemo(() => {
    const map = new Map<string, EgresoParcial>();
    ytdEgresoPartialRaw.forEach((v, k) => {
      map.set(k, {
        periodo: v.periodo,
        proveedores: adjust(v.proveedores, v.periodo),
        financieros: adjust(v.financieros, v.periodo),
      });
    });
    return map;
  }, [ytdEgresoPartialRaw, adjust]);

  // Las categorías visibles son el orden fijo de Costos Operativos
  // (whitelist definida en economic-queries.ts). El rollup ya se aplicó en
  // fetchEgresos, así que r.categorias solo tiene keys del allowlist o "Otros".
  // Se excluyen Honorarios/Seguros/Telefonía porque van a Gastos Comerciales.
  const isComercialCat = (cat: string) =>
    (COMERCIALES_PROVEEDOR_CATS as readonly string[]).includes(cat);

  const displayCategories = useMemo(() => {
    const present = new Set<string>();
    for (const r of data) {
      for (const [cat, monto] of Object.entries(r.categorias)) {
        if (isComercialCat(cat) || monto === 0) continue;
        present.add(cat);
      }
    }
    return COSTOS_OPERATIVOS_ORDER.filter((c) => present.has(c));
  }, [data]);

  const getCategoryValue = (categorias: Record<string, number>, cat: string): number =>
    categorias[cat] ?? 0;

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
  // Mismo mes año anterior — para YoY delta en KPIs
  const prevYearPeriodo = last
    ? `${parseInt(last.periodo.slice(0, 4), 10) - 1}-${last.periodo.slice(5, 7)}`
    : "";
  const prevYear = data.find((r) => r.periodo === prevYearPeriodo) ?? null;

  // Costos Operativos = sum of proveedor categorias EXCEPT las que van a
  // Gastos Comerciales (Honorarios / Seguros / Telefonía).
  const costosOp = (r: EgresoRow) =>
    Object.entries(r.categorias)
      .filter(([cat]) => !isComercialCat(cat))
      .reduce((a, [, v]) => a + v, 0);
  const lastCostosOp = costosOp(last);
  const prevCostosOp = prev ? costosOp(prev) : null;
  const prevYearCostosOp = prevYear ? costosOp(prevYear) : null;

  // Gastos Comerciales devengado: IIBB + Seg. e Higiene + cuotas fijas +
  // Imp. al Cheque + facturas de Honorarios / Seguros / Telefonía (ya
  // ajustadas por inflación en r.categorias via useEgresosData).
  const gastosComerciales = (r: EgresoRow) => {
    const ingresos = resultadoData.get(r.periodo)?.ingresos ?? 0;
    const cheque = taxData.get(r.periodo)?.cheque ?? 0;
    const impAdj = adjust(computeGastosComerciales(ingresos, r.periodo) + cheque, r.periodo);
    const proveedorCom = (COMERCIALES_PROVEEDOR_CATS as readonly string[])
      .reduce((s, k) => s + (r.categorias[k] ?? 0), 0);
    return impAdj + proveedorCom;
  };

  // Total = components sum (avoids the percibido comerciales from RPC).
  // Usa costosOp que excluye Honorarios/Seguros/Telefonía ya contabilizados
  // dentro de gastosComerciales — evita doble contabilización.
  const totalEgresos = (r: EgresoRow) => {
    const sueldos = r.sueldosNeto + r.cargasSociales;
    return costosOp(r) + sueldos + gastosComerciales(r) + r.ganancias + r.financieros;
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

      <Callout>
        <p>
          Resumen de los 5 grupos de egresos que arma el P&L. Todo devengado, en pesos ajustados al último mes vía IPC si está el toggle activo.
        </p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>
            <strong className="text-foreground">Costos Operativos</strong>: facturas recibidas netas de IVA (por categoría de proveedor).
          </li>
          <li>
            <strong className="text-foreground">Sueldos y CS</strong>: sueldo neto + cargas sociales patronales (F.931).
          </li>
          <li>
            <strong className="text-foreground">Gastos Comerciales</strong>: IIBB (4,5%), Seg. e Higiene (1%) y cuotas fijas municipales. Devengado sobre los ingresos del mes.
          </li>
          <li>
            <strong className="text-foreground">Imp. Ganancias</strong>: 36,7% estimado sobre resultado antes de Ganancias menos RECPAM (puede ser 0 si el mes dio pérdida).
          </li>
          <li>
            <strong className="text-foreground">Financieros</strong>: comisiones bancarias, intereses, seguros, comisiones MP + Imp. al Cheque.
          </li>
          <li>
            Las deltas se muestran en <span className="text-green-600">verde</span> cuando el gasto baja y en <span className="text-red-600">rojo</span> cuando sube (menos gasto = mejor).
          </li>
        </ul>
      </Callout>

      {/* KPI Cards — 6 categories */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <KpiCard
          title="Total Egresos"
          value={totalEgresos(last)}
          delta={prev ? pctDelta(totalEgresos(last), totalEgresos(prev)) : null}
          deltaYoY={prevYear ? pctDelta(totalEgresos(last), totalEgresos(prevYear)) : null}
        />
        <KpiCard
          title="Costos Operativos"
          value={lastCostosOp}
          delta={prevCostosOp !== null ? pctDelta(lastCostosOp, prevCostosOp) : null}
          deltaYoY={prevYearCostosOp !== null ? pctDelta(lastCostosOp, prevYearCostosOp) : null}
          color={OPERATIVOS_COLOR}
        />
        <KpiCard
          title="Sueldos y CS"
          value={last.sueldosNeto + last.cargasSociales}
          delta={prev ? pctDelta(last.sueldosNeto + last.cargasSociales, prev.sueldosNeto + prev.cargasSociales) : null}
          deltaYoY={prevYear ? pctDelta(last.sueldosNeto + last.cargasSociales, prevYear.sueldosNeto + prevYear.cargasSociales) : null}
          color={SUELDOS_COLOR}
        />
        <KpiCard
          title="Gastos Comerciales"
          value={gastosComerciales(last)}
          delta={prev ? pctDelta(gastosComerciales(last), gastosComerciales(prev)) : null}
          deltaYoY={prevYear ? pctDelta(gastosComerciales(last), gastosComerciales(prevYear)) : null}
          color={COMERCIALES_COLOR}
        />
        <KpiCard
          title="Imp. Ganancias"
          value={last.ganancias}
          delta={prev && prev.ganancias > 0 ? pctDelta(last.ganancias, prev.ganancias) : null}
          deltaYoY={prevYear && prevYear.ganancias > 0 ? pctDelta(last.ganancias, prevYear.ganancias) : null}
          color={GANANCIAS_COLOR}
        />
        <KpiCard
          title="Financieros"
          value={last.financieros}
          delta={prev ? pctDelta(last.financieros, prev.financieros) : null}
          deltaYoY={prevYear ? pctDelta(last.financieros, prevYear.financieros) : null}
          color={FINANCIEROS_COLOR}
        />
      </div>

      {/* YTD Comparison Table */}
      <EgresosYtdTable rows={rowsForAgg} cutoff={ytdCutoff} egresoPartial={ytdEgresoPartial} />

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

      {/* Chart: Ingresos vs Egresos mensual */}
      <IngresosVsEgresosChart rows={rowsForAgg} resultadoData={resultadoData} />

      {/* Chart: Waterfall del mes seleccionado */}
      {last && (
        <WaterfallChart
          periodo={last.periodo}
          ingresos={adjust(resultadoData.get(last.periodo)?.ingresos ?? 0, last.periodo)}
          costosOp={lastCostosOp}
          sueldos={last.sueldosNeto + last.cargasSociales}
          comerciales={gastosComerciales(last)}
          ganancias={last.ganancias}
          financieros={last.financieros}
        />
      )}

      {/* Chart: Estructura de costos % sobre ingresos (evolutivo) */}
      <EstructuraCostosPct rows={rowsForAgg} resultadoData={resultadoData} />

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
                  <TableHead className="sticky left-0 z-20 bg-card">Período</TableHead>
                  {displayCategories.map((cat) => (
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
                    <TableCell className="sticky left-0 z-10 bg-card font-medium whitespace-nowrap">{row.label}</TableCell>
                    {displayCategories.map((cat) => (
                      <TableCell key={cat} className="text-right">
                        {formatARS(getCategoryValue(row.categorias, cat))}
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
          <p className="mt-3 text-xs text-muted-foreground">
            &ldquo;Otros&rdquo; agrupa todas las categorías de proveedor fuera del listado principal (equipamiento, alquileres, sistemas, etc.). Editá la categoría de cada proveedor desde <strong>Comercial → Proveedores → Editar categorías</strong>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

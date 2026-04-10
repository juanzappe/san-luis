"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import { MonthSelector } from "@/components/month-selector";
import {
  type FinancierosDesglose,
  fetchFinancierosDesglose,
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

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------

interface CategoryDef {
  key: keyof Omit<FinancierosDesglose, "periodo" | "total">;
  label: string;
  color: string;
}

const CATEGORIES: CategoryDef[] = [
  { key: "comisionesBancarias", label: "Comisiones Bancarias", color: "#f59e0b" },
  { key: "intereses",          label: "Intereses",            color: "#ef4444" },
  { key: "seguros",            label: "Seguros",              color: "#6366f1" },
  { key: "comisionesMp",       label: "Comisiones MP",        color: "#8b5cf6" },
  { key: "otros",              label: "Otros Financieros",    color: "#94a3b8" },
];

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
// Aggregation
// ---------------------------------------------------------------------------

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

const MONTH_NAMES = [
  "Ene","Feb","Mar","Abr","May","Jun",
  "Jul","Ago","Sep","Oct","Nov","Dic",
];

interface AggRow {
  key: string;
  label: string;
  comisionesBancarias: number;
  intereses: number;
  seguros: number;
  comisionesMp: number;
  otros: number;
  total: number;
}

function aggregateRows(data: FinancierosDesglose[], granularity: Granularity): AggRow[] {
  if (granularity === "mensual") {
    return [...data]
      .map((r) => {
        const [y, m] = r.periodo.split("-");
        return {
          key: r.periodo,
          label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`,
          comisionesBancarias: r.comisionesBancarias,
          intereses: r.intereses,
          seguros: r.seguros,
          comisionesMp: r.comisionesMp,
          otros: r.otros,
          total: r.total,
        };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  const buckets = new Map<string, AggRow>();
  for (const r of data) {
    const [y, m] = r.periodo.split("-");
    const bucketKey = granularity === "trimestral" ? `${y}-${QUARTER_LABELS[m]}` : y;
    const cur = buckets.get(bucketKey);
    if (!cur) {
      buckets.set(bucketKey, {
        key: bucketKey,
        label: granularity === "trimestral" ? `${QUARTER_LABELS[m]} ${y}` : y,
        comisionesBancarias: r.comisionesBancarias,
        intereses: r.intereses,
        seguros: r.seguros,
        comisionesMp: r.comisionesMp,
        otros: r.otros,
        total: r.total,
      });
    } else {
      cur.comisionesBancarias += r.comisionesBancarias;
      cur.intereses += r.intereses;
      cur.seguros += r.seguros;
      cur.comisionesMp += r.comisionesMp;
      cur.otros += r.otros;
      cur.total += r.total;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => b.key.localeCompare(a.key));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function GastosFinancierosPage() {
  const { adjust } = useInflation();
  const [raw, setRaw] = useState<FinancierosDesglose[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedPeriodo, setSelectedPeriodo] = useState("");

  useEffect(() => {
    fetchFinancierosDesglose()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Apply inflation adjustment
  const data: FinancierosDesglose[] = useMemo(
    () =>
      raw.map((r) => ({
        periodo: r.periodo,
        comisionesBancarias: adjust(r.comisionesBancarias, r.periodo),
        intereses: adjust(r.intereses, r.periodo),
        seguros: adjust(r.seguros, r.periodo),
        comisionesMp: adjust(r.comisionesMp, r.periodo),
        otros: adjust(r.otros, r.periodo),
        total: adjust(r.total, r.periodo),
      })),
    [raw, adjust],
  );

  const periodos = data.map((r) => r.periodo);
  const activePeriodo = selectedPeriodo || periodos[periodos.length - 1] || "";
  const selectedIdx = data.findIndex((r) => r.periodo === activePeriodo);
  const last = selectedIdx >= 0 ? data[selectedIdx] : data[data.length - 1];
  const prev = selectedIdx >= 1 ? data[selectedIdx - 1] : null;

  // Filter categories that have data (sum > 0 across all months)
  const activeCategories = useMemo(() => {
    return CATEGORIES.filter((c) => data.some((r) => r[c.key] > 0));
  }, [data]);

  // Chart data — last 12 months
  const chartData = useMemo(() => {
    return data.slice(-12).map((r) => {
      const row: Record<string, string | number> = { label: shortLabel(r.periodo) };
      for (const c of CATEGORIES) {
        row[c.label] = r[c.key];
      }
      return row;
    });
  }, [data]);

  // Aggregated for table
  const aggregated = useMemo(() => aggregateRows(data, granularity), [data, granularity]);

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
          <p className="mt-3 font-medium">Sin datos de gastos financieros</p>
          <p className="text-sm text-muted-foreground">
            Ejecutá el ETL para importar movimientos bancarios y de Mercado Pago.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gastos Financieros</h1>
          <p className="text-muted-foreground">
            Comisiones bancarias, intereses, seguros y comisiones de Mercado Pago
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector periodos={periodos} value={activePeriodo} onChange={setSelectedPeriodo} />
          <InflationToggle />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <KpiCard
          title="Total Financieros"
          value={last?.total ?? 0}
          delta={prev ? pctDelta(last?.total ?? 0, prev.total) : null}
        />
        {activeCategories.map((c) => (
          <KpiCard
            key={c.key}
            title={c.label}
            value={last?.[c.key] ?? 0}
            delta={prev && prev[c.key] > 0 ? pctDelta(last?.[c.key] ?? 0, prev[c.key]) : null}
            color={c.color}
          />
        ))}
      </div>

      {/* Stacked bar chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Composición de Gastos Financieros</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={380}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              {activeCategories.map((c, i) => (
                <Bar
                  key={c.key}
                  dataKey={c.label}
                  name={c.label}
                  stackId="a"
                  fill={c.color}
                  radius={i === activeCategories.length - 1 ? [4, 4, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detail table */}
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
                  {activeCategories.map((c) => (
                    <TableHead key={c.key} className="text-right">{c.label}</TableHead>
                  ))}
                  <TableHead className="text-right font-bold">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregated.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium whitespace-nowrap">{row.label}</TableCell>
                    {activeCategories.map((c) => (
                      <TableCell key={c.key} className="text-right">
                        {formatARS(row[c.key])}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-bold">{formatARS(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Nota sobre Imp. al Cheque */}
      <p className="text-xs text-muted-foreground">
        Nota: El Impuesto al Cheque (LEY 25.413) no se incluye en Gastos Financieros — se contabiliza en Gastos Comerciales / Impuestos.
      </p>
    </div>
  );
}

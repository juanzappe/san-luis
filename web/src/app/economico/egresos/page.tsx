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
import {
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type EgresoRow,
  fetchEgresos,
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

// Dynamic palette for expense categories
const CATEGORY_COLORS = [
  "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#e11d48", "#a855f7", "#0ea5e9",
];
// Fixed colors for non-category items
const SUELDOS_COLOR = "#64748b";
const IMPUESTOS_COLOR = "#78716c";
const FINANCIEROS_COLOR = "#94a3b8";

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
  const [raw, setRaw] = useState<EgresoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEgresos()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Discover all category names sorted by total descending
  const allCategories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of raw) {
      for (const [cat, monto] of Object.entries(r.categorias)) {
        totals.set(cat, (totals.get(cat) ?? 0) + monto);
      }
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [raw]);

  // Color assignment for categories
  const catColorMap = useMemo(() => {
    const map = new Map<string, string>();
    allCategories.forEach((cat, i) => {
      map.set(cat, CATEGORY_COLORS[i % CATEGORY_COLORS.length]);
    });
    return map;
  }, [allCategories]);

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
          <p className="mt-3 font-medium">Sin datos de egresos</p>
          <p className="text-sm text-muted-foreground">
            Ejecutá el ETL para importar facturas recibidas, sueldos, impuestos y movimientos bancarios.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Apply inflation adjustment
  const data: EgresoRow[] = raw.map((r) => {
    const adjCats: Record<string, number> = {};
    for (const [cat, monto] of Object.entries(r.categorias)) {
      adjCats[cat] = adjust(monto, r.periodo);
    }
    return {
      ...r,
      operativos: adjust(r.operativos, r.periodo),
      comerciales: adjust(r.comerciales, r.periodo),
      financieros: adjust(r.financieros, r.periodo),
      ganancias: adjust(r.ganancias, r.periodo),
      total: adjust(r.total, r.periodo),
      categorias: adjCats,
      sueldos: adjust(r.sueldos, r.periodo),
      impuestos: adjust(r.impuestos, r.periodo),
    };
  });

  const last = data[data.length - 1];
  const prev = data.length >= 2 ? data[data.length - 2] : null;

  // Chart data — flatten categorias into top-level keys for Recharts
  const chartData = data.slice(-12).map((r) => {
    const flat: Record<string, string | number> = { label: shortLabel(r.periodo) };
    for (const cat of allCategories) {
      flat[cat] = r.categorias[cat] ?? 0;
    }
    flat["Sueldos"] = r.sueldos;
    flat["Impuestos"] = r.impuestos;
    flat["Financieros"] = r.financieros;
    return flat;
  });

  // Top KPI categories (top 3 by monto in last month)
  const topCats = allCategories.slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Egresos</h1>
          <p className="text-muted-foreground">
            Estructura de costos por categoría — {periodoLabel(last.periodo)}
          </p>
        </div>
        <InflationToggle />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          title="Total Egresos"
          value={last.total}
          delta={prev ? pctDelta(last.total, prev.total) : null}
        />
        {topCats.map((cat) => (
          <KpiCard
            key={cat}
            title={cat}
            value={last.categorias[cat] ?? 0}
            delta={prev ? pctDelta(last.categorias[cat] ?? 0, prev.categorias[cat] ?? 0) : null}
            color={catColorMap.get(cat)}
          />
        ))}
        <KpiCard
          title="Sueldos"
          value={last.sueldos}
          delta={prev ? pctDelta(last.sueldos, prev.sueldos) : null}
          color={SUELDOS_COLOR}
        />
      </div>

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
              {allCategories.map((cat, i) => (
                <Bar
                  key={cat}
                  dataKey={cat}
                  name={cat}
                  stackId="a"
                  fill={catColorMap.get(cat) ?? CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
                />
              ))}
              <Bar dataKey="Sueldos" name="Sueldos" stackId="a" fill={SUELDOS_COLOR} />
              <Bar dataKey="Impuestos" name="Impuestos" stackId="a" fill={IMPUESTOS_COLOR} />
              <Bar dataKey="Financieros" name="Financieros" stackId="a" fill={FINANCIEROS_COLOR} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle Mensual por Categoría</CardTitle>
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
                  <TableHead className="text-right">Sueldos</TableHead>
                  <TableHead className="text-right">Impuestos</TableHead>
                  <TableHead className="text-right">Financieros</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data].reverse().map((row) => (
                  <TableRow key={row.periodo}>
                    <TableCell className="font-medium whitespace-nowrap">{periodoLabel(row.periodo)}</TableCell>
                    {allCategories.map((cat) => (
                      <TableCell key={cat} className="text-right">
                        {formatARS(row.categorias[cat] ?? 0)}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">{formatARS(row.sueldos)}</TableCell>
                    <TableCell className="text-right">{formatARS(row.impuestos)}</TableCell>
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

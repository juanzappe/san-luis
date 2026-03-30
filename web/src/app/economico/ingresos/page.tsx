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
// Main
// ---------------------------------------------------------------------------
export default function IngresosPage() {
  const { adjust } = useInflation();
  const [raw, setRaw] = useState<IngresoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchIngresos()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

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
    </div>
  );
}

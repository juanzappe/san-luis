"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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

  // Apply inflation adjustment
  const data: IngresoRow[] = raw.map((r) => ({
    periodo: r.periodo,
    mostrador: adjust(r.mostrador, r.periodo),
    restobar: adjust(r.restobar, r.periodo),
    servicios: adjust(r.servicios, r.periodo),
    total: adjust(r.total, r.periodo),
  }));

  const last = data[data.length - 1];
  const prev = data.length >= 2 ? data[data.length - 2] : null;

  // Last 12 months for charts
  const chartData = data.slice(-12).map((r) => ({
    ...r,
    label: shortLabel(r.periodo),
  }));

  // YoY comparison: current 12 months vs previous 12 months
  const yoyData = (() => {
    if (data.length < 13) return null;
    const cur12 = data.slice(-12);
    const prev12 = data.slice(-24, -12);
    if (prev12.length < 12) return null;
    return cur12.map((r, i) => ({
      label: shortLabel(r.periodo),
      actual: r.total,
      anterior: prev12[i]?.total ?? 0,
    }));
  })();

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

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stacked bar by business unit */}
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

        {/* YoY line comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparativo Interanual</CardTitle>
          </CardHeader>
          <CardContent>
            {yoyData ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={yoyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                  <Tooltip formatter={arsTooltip} />
                  <Legend />
                  <Line type="monotone" dataKey="actual" name="Año actual" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="anterior" name="Año anterior" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Se necesitan al menos 24 meses de datos para el comparativo interanual
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly summary table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle Mensual</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Mostrador</TableHead>
                <TableHead className="text-right">Restobar</TableHead>
                <TableHead className="text-right">Servicios</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data].reverse().map((row) => (
                <TableRow key={row.periodo}>
                  <TableCell className="font-medium">{periodoLabel(row.periodo)}</TableCell>
                  <TableCell className="text-right">{formatARS(row.mostrador)}</TableCell>
                  <TableCell className="text-right">{formatARS(row.restobar)}</TableCell>
                  <TableCell className="text-right">{formatARS(row.servicios)}</TableCell>
                  <TableCell className="text-right font-medium">{formatARS(row.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

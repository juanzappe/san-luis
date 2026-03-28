"use client";

import { useEffect, useState } from "react";
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
  Wallet,
  Briefcase,
  Megaphone,
  Landmark,
  Receipt,
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

const COLORS = {
  operativos: "#ef4444",
  comerciales: "#f59e0b",
  financieros: "#3b82f6",
  ganancias: "#8b5cf6",
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
  // For expenses, negative delta = good (costs went down)
  const deltaPositive = delta !== null && delta < 0;
  const deltaNegative = delta !== null && delta > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
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
  const data: EgresoRow[] = raw.map((r) => ({
    periodo: r.periodo,
    operativos: adjust(r.operativos, r.periodo),
    comerciales: adjust(r.comerciales, r.periodo),
    financieros: adjust(r.financieros, r.periodo),
    ganancias: adjust(r.ganancias, r.periodo),
    total: adjust(r.total, r.periodo),
  }));

  const last = data[data.length - 1];
  const prev = data.length >= 2 ? data[data.length - 2] : null;

  const chartData = data.slice(-12).map((r) => ({
    ...r,
    label: shortLabel(r.periodo),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Egresos</h1>
          <p className="text-muted-foreground">
            Estructura de costos — {periodoLabel(last.periodo)}
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
          icon={Wallet}
        />
        <KpiCard
          title="Operativos"
          value={last.operativos}
          delta={prev ? pctDelta(last.operativos, prev.operativos) : null}
          icon={Briefcase}
        />
        <KpiCard
          title="Comerciales"
          value={last.comerciales}
          delta={prev ? pctDelta(last.comerciales, prev.comerciales) : null}
          icon={Megaphone}
        />
        <KpiCard
          title="Financieros"
          value={last.financieros}
          delta={prev ? pctDelta(last.financieros, prev.financieros) : null}
          icon={Landmark}
        />
        <KpiCard
          title="Imp. Ganancias"
          value={last.ganancias}
          delta={prev ? pctDelta(last.ganancias, prev.ganancias) : null}
          icon={Receipt}
        />
      </div>

      {/* Stacked bar chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Composición de Egresos Mensual</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              <Bar dataKey="operativos" name="Operativos" stackId="a" fill={COLORS.operativos} />
              <Bar dataKey="comerciales" name="Comerciales" stackId="a" fill={COLORS.comerciales} />
              <Bar dataKey="financieros" name="Financieros" stackId="a" fill={COLORS.financieros} />
              <Bar dataKey="ganancias" name="Imp. Ganancias" stackId="a" fill={COLORS.ganancias} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle Mensual</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Operativos</TableHead>
                <TableHead className="text-right">Comerciales</TableHead>
                <TableHead className="text-right">Financieros</TableHead>
                <TableHead className="text-right">Ganancias</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data].reverse().map((row) => (
                <TableRow key={row.periodo}>
                  <TableCell className="font-medium">{periodoLabel(row.periodo)}</TableCell>
                  <TableCell className="text-right">{formatARS(row.operativos)}</TableCell>
                  <TableCell className="text-right">{formatARS(row.comerciales)}</TableCell>
                  <TableCell className="text-right">{formatARS(row.financieros)}</TableCell>
                  <TableCell className="text-right">{formatARS(row.ganancias)}</TableCell>
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

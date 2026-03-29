"use client";

import { useEffect, useMemo, useState } from "react";
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
import type {
  ValueType,
  NameType,
  Formatter,
} from "recharts/types/component/DefaultTooltipContent";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Users,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type DashboardData,
  type MonthRow,
  fetchDashboardData,
  formatARS,
  formatPct,
  periodoLabel,
  pctDelta,
} from "@/lib/queries";
import { useInflation, InflationToggle } from "@/lib/inflation";

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------
const COLORS = {
  ingresos: "#22c55e",
  resultado: "#3b82f6",
  mostrador: "#8b5cf6",
  servicios: "#06b6d4",
  margen: "#ec4899",
  operativos: "#f59e0b",
  comerciales: "#ef4444",
  financieros: "#8b5cf6",
  ganancias: "#6366f1",
};

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------
function KpiCard({
  title,
  value,
  delta,
  icon: Icon,
  invertDelta,
}: {
  title: string;
  value: number;
  delta: number | null;
  icon: React.ElementType;
  invertDelta?: boolean;
}) {
  const deltaPositive = delta !== null && (invertDelta ? delta < 0 : delta > 0);
  const deltaNegative = delta !== null && (invertDelta ? delta > 0 : delta < 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatARS(value)}</div>
        {delta !== null ? (
          <p
            className={`text-xs ${
              deltaPositive
                ? "text-green-600"
                : deltaNegative
                  ? "text-red-600"
                  : "text-muted-foreground"
            }`}
          >
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
// Tooltip formatter for charts
// ---------------------------------------------------------------------------
const arsFormatter: Formatter<ValueType, NameType> = (value) =>
  formatARS(Number(value ?? 0));

const pctFormatter: Formatter<ValueType, NameType> = (value) =>
  `${Number(value ?? 0).toFixed(1)}%`;

// ---------------------------------------------------------------------------
// Últimos 12 meses helper
// ---------------------------------------------------------------------------
function last12<T extends { periodo: string }>(rows: T[]): T[] {
  return rows.slice(-12);
}

function chartLabel(periodo: string): string {
  const [, m] = periodo.split("-");
  const short = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];
  return short[parseInt(m, 10) - 1] ?? m;
}

// ---------------------------------------------------------------------------
// Main Dashboard Component
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchDashboardData()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error al cargar datos"))
      .finally(() => setLoading(false));
  }, []);

  // Apply inflation adjustment to all monetary values
  const adjustedData = useMemo(() => {
    if (!data || !data.hasData || !data.kpis) return data;

    const monthly: MonthRow[] = data.monthly.map((r) => {
      const ing = adjust(r.ingresos, r.periodo);
      const op = adjust(r.operativos, r.periodo);
      const com = adjust(r.comerciales, r.periodo);
      const fin = adjust(r.financieros, r.periodo);
      const gan = adjust(r.ganancias, r.periodo);
      const egTotal = op + com + fin + gan;
      const res = ing - egTotal;
      return {
        ...r,
        ingresos: ing,
        operativos: op,
        comerciales: com,
        financieros: fin,
        ganancias: gan,
        egresosTotal: egTotal,
        resultado: res,
        margen: ing > 0 ? (res / ing) * 100 : 0,
      };
    });

    const last = monthly[monthly.length - 1];
    const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null;

    const sueldosLast = adjust(data.kpis.sueldos, last.periodo);

    return {
      ...data,
      monthly,
      kpis: {
        ingresos: last.ingresos,
        egresos: last.egresosTotal,
        sueldos: sueldosLast,
        resultado: last.resultado,
        deltaIngresos: prev ? pctDelta(last.ingresos, prev.ingresos) : null,
        deltaEgresos: prev ? pctDelta(last.egresosTotal, prev.egresosTotal) : null,
        deltaSueldos: data.kpis.deltaSueldos,
        deltaResultado: prev ? pctDelta(last.resultado, prev.resultado) : null,
        periodo: data.kpis.periodo,
      },
    };
  }, [data, adjust]);

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando datos…</span>
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <div>
            <p className="font-medium">Error al conectar con la base de datos</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Verificá que <code className="rounded bg-muted px-1">.env.local</code> tenga{" "}
              <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
              <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // --- Empty state ---
  if (!adjustedData || !adjustedData.hasData || !adjustedData.kpis) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Sin datos todavía</p>
          <p className="text-sm text-muted-foreground">
            Ejecutá el ETL (<code className="rounded bg-muted px-1">python etl/main.py</code>)
            para importar datos a Supabase.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { kpis, monthly, incomeBySource } = adjustedData;
  const chartData = last12(monthly).map((r) => ({
    ...r,
    label: chartLabel(r.periodo),
  }));
  const incomeChartData = last12(incomeBySource).map((r) => ({
    ...r,
    label: chartLabel(r.periodo),
  }));

  return (
    <div className="space-y-6">
      {/* Inflation toggle */}
      <div className="flex justify-end">
        <InflationToggle />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Ingresos"
          value={kpis.ingresos}
          delta={kpis.deltaIngresos}
          icon={DollarSign}
        />
        <KpiCard
          title="Egresos"
          value={kpis.egresos}
          delta={kpis.deltaEgresos}
          icon={TrendingDown}
          invertDelta
        />
        <KpiCard
          title="Sueldos"
          value={kpis.sueldos}
          delta={kpis.deltaSueldos}
          icon={Users}
          invertDelta
        />
        <KpiCard
          title="Resultado Neto"
          value={kpis.resultado}
          delta={kpis.deltaResultado}
          icon={TrendingUp}
        />
      </div>

      {/* Charts — 2x2 grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 1. Resultado neto mensual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultado Neto Mensual</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsFormatter} />
                <Bar
                  dataKey="resultado"
                  name="Resultado"
                  fill={COLORS.resultado}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 2. Composición de egresos — 4 categorías */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Composición de Egresos</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsFormatter} />
                <Legend />
                <Bar
                  dataKey="operativos"
                  name="Operativos"
                  stackId="a"
                  fill={COLORS.operativos}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="comerciales"
                  name="Comerciales"
                  stackId="a"
                  fill={COLORS.comerciales}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="financieros"
                  name="Financieros"
                  stackId="a"
                  fill={COLORS.financieros}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="ganancias"
                  name="Ganancias"
                  stackId="a"
                  fill={COLORS.ganancias}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 3. Margen operativo mensual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Margen Operativo Mensual</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={pctFormatter} />
                <Line
                  type="monotone"
                  dataKey="margen"
                  name="Margen %"
                  stroke={COLORS.margen}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 4. Ingresos por origen */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ingresos por Origen</CardTitle>
          </CardHeader>
          <CardContent>
            {incomeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={incomeChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                  <Tooltip formatter={arsFormatter} />
                  <Legend />
                  <Bar
                    dataKey="mostrador"
                    name="Mostrador"
                    stackId="a"
                    fill={COLORS.mostrador}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="servicios"
                    name="Servicios"
                    stackId="a"
                    fill={COLORS.servicios}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Sin datos de ventas por origen
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabla resumen mensual */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumen Mensual</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">Egresos</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
                <TableHead className="text-right">Margen %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...monthly].reverse().map((row: MonthRow) => (
                <TableRow key={row.periodo}>
                  <TableCell className="font-medium">
                    {periodoLabel(row.periodo)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatARS(row.ingresos)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatARS(row.egresosTotal)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      row.resultado >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatARS(row.resultado)}
                  </TableCell>
                  <TableCell
                    className={`text-right ${
                      row.margen >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {row.margen.toFixed(1)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

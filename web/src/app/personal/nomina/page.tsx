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
import {
  DollarSign,
  Banknote,
  ShieldCheck,
  Users,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type NominaRow,
  fetchNomina,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/personal-queries";
import { InflationToggle, useInflation } from "@/lib/inflation";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

function KpiCard({ title, value, delta, icon: Icon }: { title: string; value: string; delta: string | null; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {delta && (
          <p className={`text-xs ${delta.startsWith("-") ? "text-red-600" : "text-green-600"}`}>
            {delta} vs mes anterior
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function NominaPage() {
  const [raw, setRaw] = useState<NominaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchNomina()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  const data = useMemo(
    () =>
      raw.map((r) => ({
        ...r,
        sueldosNetos: adjust(r.sueldosNetos, r.periodo),
        cargasSociales: adjust(r.cargasSociales, r.periodo),
        costoTotal: adjust(r.costoTotal, r.periodo),
        costoPromedio: adjust(r.costoPromedio, r.periodo),
        ingresos: adjust(r.ingresos, r.periodo),
      })),
    [raw, adjust],
  );

  // KPIs from last two months
  const kpis = useMemo(() => {
    if (data.length < 1) return null;
    const last = data[data.length - 1];
    const prev = data.length > 1 ? data[data.length - 2] : null;
    return {
      costoTotal: last.costoTotal,
      deltaCosto: prev ? pctDelta(last.costoTotal, prev.costoTotal) : null,
      sueldosNetos: last.sueldosNetos,
      deltaSueldos: prev ? pctDelta(last.sueldosNetos, prev.sueldosNetos) : null,
      cargas: last.cargasSociales,
      deltaCargas: prev ? pctDelta(last.cargasSociales, prev.cargasSociales) : null,
      empleados: last.cantEmpleados,
      deltaEmp: prev ? pctDelta(last.cantEmpleados, prev.cantEmpleados) : null,
    };
  }, [data]);

  // Chart data (last 24 months)
  const chartData = useMemo(
    () =>
      data.slice(-24).map((r) => ({
        label: shortLabel(r.periodo),
        periodo: r.periodo,
        sueldosNetos: r.sueldosNetos,
        cargasSociales: r.cargasSociales,
        costoPromedio: r.costoPromedio,
        pctIngresos: r.pctSobreIngresos,
      })),
    [data],
  );

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
      <Card><CardContent className="flex items-center gap-3 py-8">
        <AlertCircle className="h-5 w-5 text-red-500" /><p className="text-sm">{error}</p>
      </CardContent></Card>
    );
  }
  if (data.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin datos de nómina</p>
        <p className="text-sm text-muted-foreground">Importá liquidaciones de sueldo para ver la evolución.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nómina</h1>
          <p className="text-muted-foreground">Evolución mensual de sueldos y cargas sociales</p>
        </div>
        <InflationToggle />
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Costo Total" value={formatARS(kpis.costoTotal)} delta={kpis.deltaCosto ? formatPct(kpis.deltaCosto) : null} icon={DollarSign} />
          <KpiCard title="Sueldos Netos" value={formatARS(kpis.sueldosNetos)} delta={kpis.deltaSueldos ? formatPct(kpis.deltaSueldos) : null} icon={Banknote} />
          <KpiCard title="Cargas Sociales" value={formatARS(kpis.cargas)} delta={kpis.deltaCargas ? formatPct(kpis.deltaCargas) : null} icon={ShieldCheck} />
          <KpiCard title="Empleados" value={String(kpis.empleados)} delta={kpis.deltaEmp ? formatPct(kpis.deltaEmp) : null} icon={Users} />
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stacked: sueldos + cargas */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Composición del Costo Laboral</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="sueldosNetos" name="Sueldos Netos" stackId="a" fill="#3b82f6" />
                <Bar dataKey="cargasSociales" name="Cargas Sociales" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Cost per employee */}
        <Card>
          <CardHeader><CardTitle className="text-base">Costo Promedio por Empleado</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Line type="monotone" dataKey="costoPromedio" name="Costo Promedio" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* % of revenue */}
        <Card>
          <CardHeader><CardTitle className="text-base">Costo Laboral como % de Ingresos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} />
                <Line type="monotone" dataKey="pctIngresos" name="% s/Ingresos" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Detalle Mensual</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Empleados</TableHead>
                  <TableHead className="text-right">Sueldos Netos</TableHead>
                  <TableHead className="text-right">Cargas Sociales</TableHead>
                  <TableHead className="text-right">Costo Total</TableHead>
                  <TableHead className="text-right">Costo Promedio</TableHead>
                  <TableHead className="text-right">% s/Ingresos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data].reverse().map((r) => (
                  <TableRow key={r.periodo}>
                    <TableCell className="font-medium">{periodoLabel(r.periodo)}</TableCell>
                    <TableCell className="text-right">{r.cantEmpleados}</TableCell>
                    <TableCell className="text-right">{formatARS(r.sueldosNetos)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cargasSociales)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.costoTotal)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.costoPromedio)}</TableCell>
                    <TableCell className="text-right">{r.pctSobreIngresos > 0 ? `${r.pctSobreIngresos.toFixed(1)}%` : "—"}</TableCell>
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

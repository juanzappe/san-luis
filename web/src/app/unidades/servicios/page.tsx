"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, Briefcase, Users, Receipt, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type ServiciosData, fetchServicios,
  formatARS, shortLabel,
} from "@/lib/units-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const COLORS = { publico: "#3b82f6", privado: "#22c55e" };

export default function ServiciosPage() {
  const [data, setData] = useState<ServiciosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchServicios()
      .then(setData)
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
  if (error || !data) {
    return (
      <Card><CardContent className="flex items-center gap-3 py-8">
        <AlertCircle className="h-5 w-5 text-red-500" /><p className="text-sm">{error}</p>
      </CardContent></Card>
    );
  }

  const monthRows = data.monthly.map((r) => ({
    ...r,
    publicoAdj: adjust(r.publico, r.periodo),
    privadoAdj: adjust(r.privado, r.periodo),
    totalAdj: adjust(r.total, r.periodo),
    label: shortLabel(r.periodo),
  }));

  const last = monthRows[monthRows.length - 1];
  const prev = monthRows.length > 1 ? monthRows[monthRows.length - 2] : null;
  const lastDelta = last && prev ? ((last.totalAdj - prev.totalAdj) / Math.abs(prev.totalAdj || 1)) * 100 : null;

  // Tipo entidad donut
  const totalPub = data.monthly.reduce((s, r) => s + r.publico, 0);
  const totalPriv = data.monthly.reduce((s, r) => s + r.privado, 0);
  const donutData = [
    { name: "Público", value: totalPub },
    { name: "Privado", value: totalPriv },
  ];

  // Classification donut from clients
  const clasifMap = new Map<string, number>();
  for (const c of data.clients) {
    const key = c.clasificacion;
    clasifMap.set(key, (clasifMap.get(key) ?? 0) + c.monto);
  }
  const clasifData = Array.from(clasifMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const CLASIF_COLORS = [
    "#8b5cf6", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444",
    "#ec4899", "#3b82f6", "#84cc16",
  ];

  const highPublic = data.kpis.pctPublico > 80;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Servicios (Catering)</h1>
          <p className="text-muted-foreground">Facturación, clientes y estacionalidad</p>
        </div>
        <InflationToggle />
      </div>

      {/* Alert */}
      {highPublic && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <p className="text-sm text-amber-800">
              Concentración alta en sector público ({data.kpis.pctPublico.toFixed(0)}%). Considerar diversificar cartera hacia privados.
            </p>
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturación Último Mes</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(last?.totalAdj ?? 0)}</div>
            {lastDelta !== null && (
              <p className={`text-xs ${lastDelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                {lastDelta >= 0 ? "+" : ""}{lastDelta.toFixed(1)}% vs mes anterior
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clientes Activos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.kpis.cantClientes}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ticket Promedio</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(data.kpis.ticketPromedio)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">% Sector Público</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${highPublic ? "text-amber-600" : ""}`}>
              {data.kpis.pctPublico.toFixed(1)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly stacked bar (público vs privado) */}
      <Card>
        <CardHeader><CardTitle className="text-base">Facturación Mensual — Público vs Privado</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={monthRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              <Bar dataKey="publicoAdj" name="Público" stackId="a" fill={COLORS.publico} />
              <Bar dataKey="privadoAdj" name="Privado" stackId="a" fill={COLORS.privado} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Donuts: Tipo Entidad + Clasificación */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Por Tipo de Entidad</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={60} outerRadius={100}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  <Cell fill={COLORS.publico} />
                  <Cell fill={COLORS.privado} />
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Por Clasificación</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={clasifData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={60} outerRadius={100}
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  {clasifData.map((_, i) => (
                    <Cell key={i} fill={CLASIF_COLORS[i % CLASIF_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Seasonal analysis: total by month-of-year */}
      <Card>
        <CardHeader><CardTitle className="text-base">Estacionalidad (Promedio por Mes del Año)</CardTitle></CardHeader>
        <CardContent>
          {(() => {
            const byMonth = new Map<number, { sum: number; count: number }>();
            for (const r of data.monthly) {
              const m = parseInt(r.periodo.split("-")[1], 10);
              const existing = byMonth.get(m) ?? { sum: 0, count: 0 };
              existing.sum += r.total;
              existing.count += 1;
              byMonth.set(m, existing);
            }
            const MONTH_NAMES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
            const seasonData = Array.from({ length: 12 }, (_, i) => {
              const entry = byMonth.get(i + 1);
              return {
                mes: MONTH_NAMES_SHORT[i],
                promedio: entry ? entry.sum / entry.count : 0,
              };
            });
            return (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={seasonData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                  <Tooltip formatter={arsTooltip} />
                  <Bar dataKey="promedio" name="Promedio" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
        </CardContent>
      </Card>

      {/* Client ranking table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Ranking de Clientes ({data.clients.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CUIT</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Clasificación</TableHead>
                  <TableHead className="text-right">Facturación</TableHead>
                  <TableHead className="text-right">Facturas</TableHead>
                  <TableHead className="text-right">% Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.clients.slice(0, 30).map((c, i) => (
                  <TableRow key={c.cuit}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{c.nombre}</TableCell>
                    <TableCell>{c.cuit}</TableCell>
                    <TableCell>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                        c.tipoEntidad.toLowerCase().includes("público") || c.tipoEntidad.toLowerCase().includes("publico")
                          ? "bg-blue-50 text-blue-700"
                          : "bg-green-50 text-green-700"
                      }`}>
                        {c.tipoEntidad}
                      </span>
                    </TableCell>
                    <TableCell>{c.clasificacion}</TableCell>
                    <TableCell className="text-right">{formatARS(c.monto)}</TableCell>
                    <TableCell className="text-right">{c.cantFacturas}</TableCell>
                    <TableCell className="text-right">{c.pct.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
                {data.clients.length > 30 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-xs text-muted-foreground">
                      +{data.clients.length - 30} clientes más
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

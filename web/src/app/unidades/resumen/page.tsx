"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, Store, Coffee, Briefcase, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type ResumenData, fetchResumen,
  formatARS, formatPct, pctDelta, periodoLabel, shortLabel,
} from "@/lib/units-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const COLORS = {
  mostrador: "#8b5cf6",
  restobar: "#06b6d4",
  servicios: "#22c55e",
};

function KpiCard({ title, value, delta, icon: Icon }: {
  title: string; value: number; delta: number | null; icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatARS(value)}</div>
        {delta !== null && (
          <p className={`text-xs ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
            {formatPct(delta)} vs mes anterior
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResumenUnidadesPage() {
  const [data, setData] = useState<ResumenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchResumen()
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

  const rows = data.monthly.map((r) => ({
    ...r,
    mostrador: adjust(r.mostrador, r.periodo),
    restobar: adjust(r.restobar, r.periodo),
    servicios: adjust(r.servicios, r.periodo),
    total: adjust(r.total, r.periodo),
    label: shortLabel(r.periodo),
  }));

  const last = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;

  // Participation donut
  const donutData = [
    { name: "Mostrador", value: data.kpis.totalMostrador },
    { name: "Restobar", value: data.kpis.totalRestobar },
    { name: "Servicios", value: data.kpis.totalServicios },
  ];
  const donutColors = [COLORS.mostrador, COLORS.restobar, COLORS.servicios];

  // Participation evolution (%)
  const pctRows = rows.map((r) => ({
    label: r.label,
    mostrador: r.total > 0 ? (r.mostrador / r.total) * 100 : 0,
    restobar: r.total > 0 ? (r.restobar / r.total) * 100 : 0,
    servicios: r.total > 0 ? (r.servicios / r.total) * 100 : 0,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resumen de Unidades</h1>
          <p className="text-muted-foreground">Comparativo entre unidades de negocio</p>
        </div>
        <InflationToggle />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard title="Total Ingresos" value={last?.total ?? 0} delta={prev ? pctDelta(last.total, prev.total) : null} icon={TrendingUp} />
        <KpiCard title="Mostrador" value={last?.mostrador ?? 0} delta={prev ? pctDelta(last.mostrador, prev.mostrador) : null} icon={Store} />
        <KpiCard title="Restobar" value={last?.restobar ?? 0} delta={prev ? pctDelta(last.restobar, prev.restobar) : null} icon={Coffee} />
        <KpiCard title="Servicios" value={last?.servicios ?? 0} delta={prev ? pctDelta(last.servicios, prev.servicios) : null} icon={Briefcase} />
      </div>

      {/* Stacked bars + Participation donut */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Ingresos por Unidad</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="mostrador" name="Mostrador" stackId="a" fill={COLORS.mostrador} />
                <Bar dataKey="restobar" name="Restobar" stackId="a" fill={COLORS.restobar} />
                <Bar dataKey="servicios" name="Servicios" stackId="a" fill={COLORS.servicios} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Participación Acumulada</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={60} outerRadius={100} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  {donutData.map((_, i) => (
                    <Cell key={i} fill={donutColors[i]} />
                  ))}
                </Pie>
                <Tooltip formatter={arsTooltip} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Participation evolution (%) */}
      <Card>
        <CardHeader><CardTitle className="text-base">Evolución de Participación (%)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={pctRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} />
              <Legend />
              <Line type="monotone" dataKey="mostrador" name="Mostrador" stroke={COLORS.mostrador} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="restobar" name="Restobar" stroke={COLORS.restobar} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="servicios" name="Servicios" stroke={COLORS.servicios} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Ticket comparison */}
      <Card>
        <CardHeader><CardTitle className="text-base">Ticket Promedio por Unidad</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { name: "Mostrador", value: data.kpis.ticketMostrador, color: COLORS.mostrador },
              { name: "Restobar", value: data.kpis.ticketRestobar, color: COLORS.restobar },
              { name: "Servicios", value: data.kpis.ticketServicios, color: COLORS.servicios },
            ].map((t) => (
              <div key={t.name} className="rounded-lg border p-4 text-center">
                <div className="h-2 rounded mb-3" style={{ backgroundColor: t.color }} />
                <p className="text-sm text-muted-foreground">{t.name}</p>
                <p className="text-2xl font-bold">{formatARS(t.value)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Monthly table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Detalle Mensual</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
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
                {rows.map((r) => (
                  <TableRow key={r.periodo}>
                    <TableCell className="font-medium">{periodoLabel(r.periodo)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.mostrador)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.restobar)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.servicios)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatARS(r.total)}</TableCell>
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

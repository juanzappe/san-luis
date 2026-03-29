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
  ResponsiveContainer,
} from "recharts";
import {
  DollarSign,
  Calculator,
  Percent,
  FileText,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type CargaSocialRow,
  type CargaSocialMensual,
  fetchCargasSociales,
  formatARS,
  shortLabel,
  periodoLabel,
} from "@/lib/personal-queries";
import { InflationToggle, useInflation } from "@/lib/inflation";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

function KpiCard({ title, value, icon: Icon }: { title: string; value: string; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function CargasSocialesPage() {
  const [pagos, setPagos] = useState<CargaSocialRow[]>([]);
  const [mensual, setMensual] = useState<CargaSocialMensual[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchCargasSociales()
      .then((d) => { setPagos(d.pagos); setMensual(d.mensual); })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Adjusted mensual data
  const adjMensual = useMemo(
    () => mensual.map((m) => ({
      ...m,
      total: adjust(m.total, m.periodo),
      sueldosNetos: adjust(m.sueldosNetos, m.periodo),
    })),
    [mensual, adjust],
  );

  // KPIs
  const kpis = useMemo(() => {
    const last12 = adjMensual.slice(-12);
    const totalPagado = last12.reduce((s, m) => s + m.total, 0);
    const promMensual = last12.length > 0 ? totalPagado / last12.length : 0;
    const lastRatio = adjMensual.length > 0 ? adjMensual[adjMensual.length - 1].ratio : 0;
    return { totalPagado, promMensual, lastRatio, cantPagos: pagos.length };
  }, [adjMensual, pagos]);

  // Chart data
  const chartData = useMemo(
    () => adjMensual.slice(-24).map((m) => ({
      label: shortLabel(m.periodo),
      total: m.total,
      ratio: m.ratio,
    })),
    [adjMensual],
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
  if (pagos.length === 0 && mensual.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin datos de cargas sociales</p>
        <p className="text-sm text-muted-foreground">Importá pagos de F931/SICOSS para ver el detalle.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cargas Sociales</h1>
          <p className="text-muted-foreground">Pagos de F931/SICOSS y contribuciones patronales</p>
        </div>
        <InflationToggle />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total Pagado (12m)" value={formatARS(kpis.totalPagado)} icon={DollarSign} />
        <KpiCard title="Promedio Mensual" value={formatARS(kpis.promMensual)} icon={Calculator} />
        <KpiCard title="Ratio Cargas/Sueldos" value={`${kpis.lastRatio.toFixed(1)}%`} icon={Percent} />
        <KpiCard title="Cantidad de Pagos" value={String(kpis.cantPagos)} icon={FileText} />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Cargas Sociales Mensuales</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Bar dataKey="total" name="Cargas Sociales" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Ratio Cargas / Sueldos Netos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} />
                <Line type="monotone" dataKey="ratio" name="Ratio %" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Detail table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Detalle de Pagos</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha Pago</TableHead>
                  <TableHead>Concepto</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Período</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagos.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{p.fechaPago}</TableCell>
                    <TableCell>{p.concepto}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(adjust(p.monto, p.periodo))}</TableCell>
                    <TableCell>{periodoLabel(p.periodo)}</TableCell>
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

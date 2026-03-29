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
  ReferenceLine,
} from "recharts";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  TrendingUp,
  Sigma,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type FlujoDeFondosRow,
  fetchFlujoDeFondos,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/financial-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const COLORS = {
  cobros: "#22c55e",
  pagos: "#ef4444",
  efectivo: "#f59e0b",
  banco: "#3b82f6",
  mp: "#8b5cf6",
  proveedores: "#ef4444",
  sueldos: "#f97316",
  impuestos: "#06b6d4",
  comisiones: "#64748b",
  neto: "#3b82f6",
};

function KpiCard({
  title, value, delta, icon: Icon, invertDelta,
}: {
  title: string; value: number; delta: number | null; icon: React.ElementType; invertDelta?: boolean;
}) {
  const good = delta !== null && (invertDelta ? delta < 0 : delta > 0);
  const bad = delta !== null && (invertDelta ? delta > 0 : delta < 0);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatARS(value)}</div>
        {delta !== null ? (
          <p className={`text-xs ${good ? "text-green-600" : bad ? "text-red-600" : "text-muted-foreground"}`}>
            {formatPct(delta)} vs mes anterior
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Sin mes anterior</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function FlujoDeFondosPage() {
  const { adjust } = useInflation();
  const [raw, setRaw] = useState<FlujoDeFondosRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFlujoDeFondos()
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
      <Card><CardContent className="flex items-center gap-3 py-8">
        <AlertCircle className="h-5 w-5 text-red-500" /><p className="text-sm">{error}</p>
      </CardContent></Card>
    );
  }
  if (raw.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin datos de flujo de fondos</p>
        <p className="text-sm text-muted-foreground">Ejecutá el ETL para importar movimientos.</p>
      </CardContent></Card>
    );
  }

  // Inflation-adjust (recompute acumulado after adjustment)
  let acum = 0;
  const data: FlujoDeFondosRow[] = raw.map((r) => {
    const ce = adjust(r.cobrosEfectivo, r.periodo);
    const cb = adjust(r.cobrosBanco, r.periodo);
    const cm = adjust(r.cobrosMP, r.periodo);
    const tc = ce + cb + cm;
    const pp = adjust(r.pagosProveedores, r.periodo);
    const su = adjust(r.sueldos, r.periodo);
    const im = adjust(r.impuestos, r.periodo);
    const co = adjust(r.comisionesBancarias, r.periodo);
    const tp = pp + su + im + co;
    const fn = tc - tp;
    acum += fn;
    return {
      periodo: r.periodo,
      cobrosEfectivo: ce, cobrosBanco: cb, cobrosMP: cm, totalCobros: tc,
      pagosProveedores: pp, sueldos: su, impuestos: im, comisionesBancarias: co, totalPagos: tp,
      flujoNeto: fn, acumulado: acum,
    };
  });

  const last = data[data.length - 1];
  const prev = data.length >= 2 ? data[data.length - 2] : null;
  const acum12 = data.slice(-12).reduce((s, r) => s + r.flujoNeto, 0);

  const chartData = data.slice(-24).map((r) => ({ ...r, label: shortLabel(r.periodo) }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Flujo de Fondos</h1>
          <p className="text-muted-foreground">Método directo — {periodoLabel(last.periodo)}</p>
        </div>
        <InflationToggle />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total Cobrado" value={last.totalCobros} delta={prev ? pctDelta(last.totalCobros, prev.totalCobros) : null} icon={ArrowDownCircle} />
        <KpiCard title="Total Pagado" value={last.totalPagos} delta={prev ? pctDelta(last.totalPagos, prev.totalPagos) : null} icon={ArrowUpCircle} invertDelta />
        <KpiCard title="Flujo Neto" value={last.flujoNeto} delta={prev ? pctDelta(last.flujoNeto, prev.flujoNeto) : null} icon={TrendingUp} />
        <KpiCard title="Acumulado 12m" value={acum12} delta={null} icon={Sigma} />
      </div>

      {/* Charts 2x2 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Cobros vs Pagos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="totalCobros" name="Cobros" fill={COLORS.cobros} radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalPagos" name="Pagos" fill={COLORS.pagos} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Flujo Neto Acumulado</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="acumulado" name="Acumulado" stroke={COLORS.neto} strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Composición de Cobros</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="cobrosEfectivo" name="Efectivo" stackId="c" fill={COLORS.efectivo} />
                <Bar dataKey="cobrosBanco" name="Banco" stackId="c" fill={COLORS.banco} />
                <Bar dataKey="cobrosMP" name="Mercado Pago" stackId="c" fill={COLORS.mp} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Composición de Pagos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="pagosProveedores" name="Proveedores" stackId="p" fill={COLORS.proveedores} />
                <Bar dataKey="sueldos" name="Sueldos" stackId="p" fill={COLORS.sueldos} />
                <Bar dataKey="impuestos" name="Impuestos" stackId="p" fill={COLORS.impuestos} />
                <Bar dataKey="comisionesBancarias" name="Comisiones" stackId="p" fill={COLORS.comisiones} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Resumen Mensual</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Efectivo</TableHead>
                  <TableHead className="text-right">Banco</TableHead>
                  <TableHead className="text-right">MP</TableHead>
                  <TableHead className="text-right font-bold">Cobros</TableHead>
                  <TableHead className="text-right">Proveedores</TableHead>
                  <TableHead className="text-right">Sueldos</TableHead>
                  <TableHead className="text-right">Impuestos</TableHead>
                  <TableHead className="text-right">Comisiones</TableHead>
                  <TableHead className="text-right font-bold">Pagos</TableHead>
                  <TableHead className="text-right font-bold">Neto</TableHead>
                  <TableHead className="text-right font-bold">Acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data].reverse().map((r) => (
                  <TableRow key={r.periodo}>
                    <TableCell className="font-medium whitespace-nowrap">{periodoLabel(r.periodo)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cobrosEfectivo)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cobrosBanco)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cobrosMP)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.totalCobros)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.pagosProveedores)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.sueldos)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.impuestos)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.comisionesBancarias)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.totalPagos)}</TableCell>
                    <TableCell className={`text-right font-bold ${r.flujoNeto >= 0 ? "text-green-600" : "text-red-600"}`}>{formatARS(r.flujoNeto)}</TableCell>
                    <TableCell className={`text-right font-bold ${r.acumulado >= 0 ? "text-green-600" : "text-red-600"}`}>{formatARS(r.acumulado)}</TableCell>
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

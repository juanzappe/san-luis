"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  DollarSign,
  Percent,
  Receipt,
  CalendarClock,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type ResumenFiscalData,
  fetchResumenFiscal,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/tax-queries";
import { InflationToggle, useInflation } from "@/lib/inflation";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const STACK_COLORS: Record<string, string> = {
  iva: "#3b82f6",
  ganancias: "#8b5cf6",
  iibb: "#22c55e",
  tasaMunicipal: "#f59e0b",
  cargasSociales: "#ef4444",
  debitosCreditos: "#06b6d4",
};

const PIE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6"];

function KpiCard({ title, value, sub, icon: Icon }: { title: string; value: string; sub?: string | null; icon: React.ElementType }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && (
          <p className={`text-xs ${sub.startsWith("-") ? "text-red-600" : "text-green-600"}`}>
            {sub} vs mes anterior
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResumenFiscalPage() {
  const [raw, setRaw] = useState<ResumenFiscalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchResumenFiscal()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  const data = useMemo(() => {
    if (!raw) return null;
    return {
      ...raw,
      mensual: raw.mensual.map((r) => ({
        ...r,
        iva: adjust(r.iva, r.periodo),
        ganancias: adjust(r.ganancias, r.periodo),
        iibb: adjust(r.iibb, r.periodo),
        tasaMunicipal: adjust(r.tasaMunicipal, r.periodo),
        cargasSociales: adjust(r.cargasSociales, r.periodo),
        debitosCreditos: adjust(r.debitosCreditos, r.periodo),
        total: adjust(r.total, r.periodo),
        ingresos: adjust(r.ingresos, r.periodo),
      })),
    };
  }, [raw, adjust]);

  const kpis = useMemo(() => {
    if (!data || data.mensual.length < 1) return null;
    const last = data.mensual[data.mensual.length - 1];
    const prev = data.mensual.length > 1 ? data.mensual[data.mensual.length - 2] : null;
    return {
      total: last.total,
      deltaTotal: prev ? pctDelta(last.total, prev.total) : null,
      presion: last.presionFiscal,
      deltaPresion: prev ? pctDelta(last.presionFiscal, prev.presionFiscal) : null,
      posIva: last.iva,
      deltaIva: prev ? pctDelta(last.iva, prev.iva) : null,
    };
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.mensual.slice(-24).map((r) => ({
      label: shortLabel(r.periodo),
      iva: r.iva,
      ganancias: r.ganancias,
      iibb: r.iibb,
      tasaMunicipal: r.tasaMunicipal,
      cargasSociales: r.cargasSociales,
      debitosCreditos: r.debitosCreditos,
      presionFiscal: r.presionFiscal,
    }));
  }, [data]);

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
  if (!data || data.mensual.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin datos de impuestos</p>
        <p className="text-sm text-muted-foreground">Importá pagos de impuestos para ver el resumen fiscal.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resumen Fiscal</h1>
          <p className="text-muted-foreground">Panorama de carga impositiva y presión fiscal</p>
        </div>
        <InflationToggle />
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Impuestos del Mes" value={formatARS(kpis.total)} sub={kpis.deltaTotal != null ? formatPct(kpis.deltaTotal) : null} icon={DollarSign} />
          <KpiCard title="Presión Fiscal" value={`${kpis.presion.toFixed(1)}%`} sub={kpis.deltaPresion != null ? formatPct(kpis.deltaPresion) : null} icon={Percent} />
          <KpiCard title="IVA del Mes" value={formatARS(kpis.posIva)} sub={kpis.deltaIva != null ? formatPct(kpis.deltaIva) : null} icon={Receipt} />
          {data.proximoVto ? (
            <KpiCard title="Próximo Vencimiento" value={data.proximoVto.impuesto} sub={data.proximoVto.fecha} icon={CalendarClock} />
          ) : (
            <KpiCard title="Próximo Vencimiento" value="—" icon={CalendarClock} />
          )}
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Stacked bars by tipo */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Composición de Impuestos por Tipo</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="iva" name="IVA" stackId="a" fill={STACK_COLORS.iva} />
                <Bar dataKey="ganancias" name="Ganancias" stackId="a" fill={STACK_COLORS.ganancias} />
                <Bar dataKey="iibb" name="IIBB" stackId="a" fill={STACK_COLORS.iibb} />
                <Bar dataKey="tasaMunicipal" name="Municipal" stackId="a" fill={STACK_COLORS.tasaMunicipal} />
                <Bar dataKey="cargasSociales" name="Cargas Soc." stackId="a" fill={STACK_COLORS.cargasSociales} />
                <Bar dataKey="debitosCreditos" name="Déb./Créd." stackId="a" fill={STACK_COLORS.debitosCreditos} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Presión fiscal line */}
        <Card>
          <CardHeader><CardTitle className="text-base">Presión Fiscal Mensual</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} />
                <Line type="monotone" dataKey="presionFiscal" name="Presión Fiscal %" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Jurisdicción donut */}
        <Card>
          <CardHeader><CardTitle className="text-base">Distribución por Jurisdicción</CardTitle></CardHeader>
          <CardContent>
            {data.distribucionJurisdiccion.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={data.distribucionJurisdiccion}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={110}
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                    fontSize={11}
                  >
                    {data.distribucionJurisdiccion.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={arsTooltip} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">Sin datos</p>
            )}
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
                  <TableHead className="text-right">IVA</TableHead>
                  <TableHead className="text-right">Ganancias</TableHead>
                  <TableHead className="text-right">IIBB</TableHead>
                  <TableHead className="text-right">Municipal</TableHead>
                  <TableHead className="text-right">Cargas Soc.</TableHead>
                  <TableHead className="text-right">Déb./Créd.</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Ingresos</TableHead>
                  <TableHead className="text-right">Presión %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.mensual].reverse().map((r) => (
                  <TableRow key={r.periodo}>
                    <TableCell className="font-medium">{periodoLabel(r.periodo)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.iva)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.ganancias)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.iibb)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.tasaMunicipal)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cargasSociales)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.debitosCreditos)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.total)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.ingresos)}</TableCell>
                    <TableCell className="text-right">{r.presionFiscal > 0 ? `${r.presionFiscal.toFixed(1)}%` : "—"}</TableCell>
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

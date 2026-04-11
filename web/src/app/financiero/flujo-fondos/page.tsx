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
  Scale,
  Calendar,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import { MonthSelector } from "@/components/month-selector";
import {
  type FlujoDeFondosRow,
  type SaldoCuenta,
  fetchFlujoDeFondos,
  fetchSaldosCuentas,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/financial-queries";
import { DetallePorCategoria } from "./detalle-categoria";
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
  financieros: "#64748b",
  retirosSocios: "#d946ef",
  neto: "#3b82f6",
};

type Granularity = "mensual" | "trimestral" | "anual";

const GRANULARITY_LABELS: Record<Granularity, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  anual: "Anual",
};

const QUARTER_LABELS: Record<string, string> = {
  "01": "Q1", "02": "Q1", "03": "Q1",
  "04": "Q2", "05": "Q2", "06": "Q2",
  "07": "Q3", "08": "Q3", "09": "Q3",
  "10": "Q4", "11": "Q4", "12": "Q4",
};

interface AggregatedFlujo {
  key: string;
  label: string;
  cobrosEfectivo: number;
  cobrosBanco: number;
  cobrosMP: number;
  totalCobros: number;
  pagosProveedores: number;
  pagosSueldos: number;
  pagosImpuestos: number;
  pagosGastosFinancieros: number;
  totalPagos: number;
  flujoNeto: number;
  acumulado: number;
  retirosSocios: number;
}

function aggregateFlujoDeFondos(data: FlujoDeFondosRow[], granularity: Granularity): AggregatedFlujo[] {
  if (granularity === "mensual") {
    return [...data]
      .map((r) => ({ ...r, key: r.periodo, label: periodoLabel(r.periodo) }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  const buckets = new Map<string, AggregatedFlujo>();
  // data is sorted ascending — iterate in order so last acumulado per bucket is correct
  for (const r of data) {
    const [y, m] = r.periodo.split("-");
    const bucketKey = granularity === "trimestral" ? `${y}-${QUARTER_LABELS[m]}` : y;
    const cur = buckets.get(bucketKey) ?? {
      key: bucketKey,
      label: granularity === "trimestral" ? `${QUARTER_LABELS[m]} ${y}` : y,
      cobrosEfectivo: 0, cobrosBanco: 0, cobrosMP: 0, totalCobros: 0,
      pagosProveedores: 0, pagosSueldos: 0, pagosImpuestos: 0, pagosGastosFinancieros: 0,
      totalPagos: 0, flujoNeto: 0,
      acumulado: 0, retirosSocios: 0,
    };
    cur.cobrosEfectivo += r.cobrosEfectivo;
    cur.cobrosBanco += r.cobrosBanco;
    cur.cobrosMP += r.cobrosMP;
    cur.totalCobros += r.totalCobros;
    cur.pagosProveedores += r.pagosProveedores;
    cur.pagosSueldos += r.pagosSueldos;
    cur.pagosImpuestos += r.pagosImpuestos;
    cur.pagosGastosFinancieros += r.pagosGastosFinancieros;
    cur.retirosSocios += r.retirosSocios;
    cur.totalPagos += r.totalPagos;
    cur.flujoNeto += r.flujoNeto;
    cur.acumulado = r.acumulado; // last row in bucket = end-of-period cumulative
    buckets.set(bucketKey, cur);
  }

  return Array.from(buckets.values()).sort((a, b) => b.key.localeCompare(a.key));
}

function KpiCard({
  title, value, delta, icon: Icon, invertDelta, format, subtitle,
}: {
  title: string; value: number; delta: number | null; icon: React.ElementType;
  invertDelta?: boolean; format?: (v: number) => string; subtitle?: string;
}) {
  const fmt = format ?? formatARS;
  const good = delta !== null && (invertDelta ? delta < 0 : delta > 0);
  const bad = delta !== null && (invertDelta ? delta > 0 : delta < 0);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{fmt(value)}</div>
        {subtitle ? (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        ) : delta !== null ? (
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
  const [saldos, setSaldos] = useState<SaldoCuenta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedPeriodo, setSelectedPeriodo] = useState("");

  useEffect(() => {
    Promise.all([
      fetchFlujoDeFondos(),
      fetchSaldosCuentas().catch(() => [] as SaldoCuenta[]),
    ])
      .then(([ff, sc]) => { setRaw(ff); setSaldos(sc); })
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
    const su = adjust(r.pagosSueldos, r.periodo);
    const im = adjust(r.pagosImpuestos, r.periodo);
    const gf = adjust(r.pagosGastosFinancieros, r.periodo);
    const tp = pp + su + im + gf;
    const rs = adjust(r.retirosSocios, r.periodo);
    const fn = tc - tp;
    acum += fn;
    return {
      periodo: r.periodo,
      cobrosEfectivo: ce, cobrosBanco: cb, cobrosMP: cm, totalCobros: tc,
      pagosProveedores: pp, pagosSueldos: su, pagosImpuestos: im, pagosGastosFinancieros: gf, totalPagos: tp,
      flujoNeto: fn, acumulado: acum, retirosSocios: rs,
    };
  });

  const periodos = data.map((r) => r.periodo);
  const activePeriodo = selectedPeriodo || periodos[periodos.length - 1] || "";
  const selectedIdx = data.findIndex((r) => r.periodo === activePeriodo);
  const last = selectedIdx >= 0 ? data[selectedIdx] : data[data.length - 1];
  const prev = selectedIdx >= 1 ? data[selectedIdx - 1] : null;
  const acum12 = data.slice(-12).reduce((s, r) => s + r.flujoNeto, 0);

  // Ratio de cobertura: Cobros / Pagos
  const ratioActual = last.totalPagos > 0 ? last.totalCobros / last.totalPagos : 0;
  const ratioPrev = prev && prev.totalPagos > 0 ? prev.totalCobros / prev.totalPagos : null;
  const ratioDelta = ratioPrev !== null ? ((ratioActual - ratioPrev) / ratioPrev) * 100 : null;

  // Días de caja: saldo total / promedio pagos diarios (últimos 3 meses)
  const saldoTotal = saldos.reduce((s, c) => s + c.saldoArs, 0);
  const last3 = data.slice(-3);
  const avgMonthlyPagos = last3.length > 0 ? last3.reduce((s, r) => s + r.totalPagos, 0) / last3.length : 0;
  const avgDailyPagos = avgMonthlyPagos / 30;
  const diasDeCaja = avgDailyPagos > 0 ? Math.round(saldoTotal / avgDailyPagos) : 0;

  // Available years for detail component
  const availableYears = Array.from(new Set(data.map((r) => parseInt(r.periodo.slice(0, 4))))).sort((a, b) => b - a);

  const chartData = data.slice(-24).map((r) => ({ ...r, label: shortLabel(r.periodo) }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Flujo de Fondos</h1>
          <p className="text-muted-foreground">Método directo — {periodoLabel(last.periodo)}</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector periodos={periodos} value={activePeriodo} onChange={setSelectedPeriodo} />
          <InflationToggle />
        </div>
      </div>

      {/* KPIs — reflejan el mes seleccionado */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <KpiCard title="Total Cobrado" value={last.totalCobros} delta={prev ? pctDelta(last.totalCobros, prev.totalCobros) : null} icon={ArrowDownCircle} />
        <KpiCard title="Total Pagado" value={last.totalPagos} delta={prev ? pctDelta(last.totalPagos, prev.totalPagos) : null} icon={ArrowUpCircle} invertDelta />
        <KpiCard title="Flujo Neto" value={last.flujoNeto} delta={prev ? pctDelta(last.flujoNeto, prev.flujoNeto) : null} icon={TrendingUp} />
        <KpiCard title="Acumulado 12m" value={acum12} delta={null} icon={Sigma} />
        <KpiCard
          title="Ratio de Cobertura"
          value={ratioActual}
          delta={ratioDelta}
          icon={Scale}
          format={(v) => `${v.toFixed(2)}x`}
          subtitle={ratioActual >= 1 ? "Cobrás más de lo que pagás" : "Pagás más de lo que cobrás"}
        />
        <KpiCard
          title="Días de Caja"
          value={diasDeCaja}
          delta={null}
          icon={Calendar}
          format={(v) => `${v} días`}
          subtitle={saldos.length > 0 ? `Saldo: ${formatARS(saldoTotal)}` : "Sin datos de saldos"}
        />
      </div>

      {/* Main charts — full width */}
      <div className="grid gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Cobros vs Pagos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={420}>
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
            <ResponsiveContainer width="100%" height={420}>
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
      </div>

      {/* Composition charts — 2 columns on desktop */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Composición de Cobros</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
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
          <CardHeader><CardTitle className="text-base">Composición de Egresos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                {/* Operativos (stacked) */}
                <Bar dataKey="pagosProveedores" name="Proveedores" stackId="p" fill={COLORS.proveedores} />
                <Bar dataKey="pagosSueldos" name="Sueldos" stackId="p" fill={COLORS.sueldos} />
                <Bar dataKey="pagosImpuestos" name="Impuestos" stackId="p" fill={COLORS.impuestos} />
                <Bar dataKey="pagosGastosFinancieros" name="Gastos Financieros" stackId="p" fill={COLORS.financieros} radius={[4, 4, 0, 0]} />
                {/* No operativo (separate bar, not stacked) */}
                <Bar dataKey="retirosSocios" name="Retiros socios" fill={COLORS.retirosSocios} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Table with granularity selector */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Resumen {GRANULARITY_LABELS[granularity]}</CardTitle>
          <div className="flex items-center rounded-lg border text-xs font-medium">
            {(["mensual", "trimestral", "anual"] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 capitalize transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  granularity === g
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </CardHeader>
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
                  <TableHead className="text-right">Gtos. Fin.</TableHead>
                  <TableHead className="text-right font-bold">Pagos</TableHead>
                  <TableHead className="text-right">Retiros</TableHead>
                  <TableHead className="text-right font-bold">Neto</TableHead>
                  <TableHead className="text-right font-bold">Acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregateFlujoDeFondos(data, granularity).map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium whitespace-nowrap">{r.label}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cobrosEfectivo)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cobrosBanco)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cobrosMP)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.totalCobros)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.pagosProveedores)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.pagosSueldos)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.pagosImpuestos)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.pagosGastosFinancieros)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.totalPagos)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.retirosSocios)}</TableCell>
                    <TableCell className={`text-right font-bold ${r.flujoNeto >= 0 ? "text-green-600" : "text-red-600"}`}>{formatARS(r.flujoNeto)}</TableCell>
                    <TableCell className={`text-right font-bold ${r.acumulado >= 0 ? "text-green-600" : "text-red-600"}`}>{formatARS(r.acumulado)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detalle por categoría */}
      {availableYears.length > 0 && (
        <DetallePorCategoria availableYears={availableYears} adjust={adjust} />
      )}
    </div>
  );
}

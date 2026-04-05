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
import { MonthSelector } from "@/components/month-selector";
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
  sueldos: number;
  impuestos: number;
  comisionesBancarias: number;
  egresosMP: number;
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
      pagosProveedores: 0, sueldos: 0, impuestos: 0, comisionesBancarias: 0,
      egresosMP: 0, totalPagos: 0, flujoNeto: 0,
      acumulado: 0, retirosSocios: 0,
    };
    cur.cobrosEfectivo += r.cobrosEfectivo;
    cur.cobrosBanco += r.cobrosBanco;
    cur.cobrosMP += r.cobrosMP;
    cur.totalCobros += r.totalCobros;
    cur.pagosProveedores += r.pagosProveedores;
    cur.sueldos += r.sueldos;
    cur.impuestos += r.impuestos;
    cur.comisionesBancarias += r.comisionesBancarias;
    cur.egresosMP += r.egresosMP;
    cur.retirosSocios += r.retirosSocios;
    cur.totalPagos += r.totalPagos;
    cur.flujoNeto += r.flujoNeto;
    cur.acumulado = r.acumulado; // last row in bucket = end-of-period cumulative
    buckets.set(bucketKey, cur);
  }

  return Array.from(buckets.values()).sort((a, b) => b.key.localeCompare(a.key));
}

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
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedPeriodo, setSelectedPeriodo] = useState("");

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
    const em = adjust(r.egresosMP, r.periodo);
    const tp = pp + su + im + co + em;
    const rs = adjust(r.retirosSocios, r.periodo);
    const fn = tc - tp;
    acum += fn;
    return {
      periodo: r.periodo,
      cobrosEfectivo: ce, cobrosBanco: cb, cobrosMP: cm, totalCobros: tc,
      pagosProveedores: pp, sueldos: su, impuestos: im, comisionesBancarias: co, egresosMP: em, totalPagos: tp,
      flujoNeto: fn, acumulado: acum, retirosSocios: rs,
    };
  });

  const periodos = data.map((r) => r.periodo);
  const activePeriodo = selectedPeriodo || periodos[periodos.length - 1] || "";
  const selectedIdx = data.findIndex((r) => r.periodo === activePeriodo);
  const last = selectedIdx >= 0 ? data[selectedIdx] : data[data.length - 1];
  const prev = selectedIdx >= 1 ? data[selectedIdx - 1] : null;
  const acum12 = data.slice(-12).reduce((s, r) => s + r.flujoNeto, 0);

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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total Cobrado" value={last.totalCobros} delta={prev ? pctDelta(last.totalCobros, prev.totalCobros) : null} icon={ArrowDownCircle} />
        <KpiCard title="Total Pagado" value={last.totalPagos} delta={prev ? pctDelta(last.totalPagos, prev.totalPagos) : null} icon={ArrowUpCircle} invertDelta />
        <KpiCard title="Flujo Neto" value={last.flujoNeto} delta={prev ? pctDelta(last.flujoNeto, prev.flujoNeto) : null} icon={TrendingUp} />
        <KpiCard title="Acumulado 12m" value={acum12} delta={null} icon={Sigma} />
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
          <CardHeader><CardTitle className="text-base">Composición de Pagos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Bar dataKey="pagosProveedores" name="Proveedores" stackId="p" fill={COLORS.proveedores} />
                <Bar dataKey="sueldos" name="Sueldos" stackId="p" fill={COLORS.sueldos} />
                <Bar dataKey="impuestos" name="Impuestos" stackId="p" fill={COLORS.impuestos} />
                <Bar dataKey="comisionesBancarias" name="Comisiones" stackId="p" fill={COLORS.comisiones} />
                <Bar dataKey="egresosMP" name="Egresos MP" stackId="p" fill={COLORS.mp} radius={[4, 4, 0, 0]} />
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
                  <TableHead className="text-right">Comisiones</TableHead>
                  <TableHead className="text-right">Egresos MP</TableHead>
                  <TableHead className="text-right">Retiros</TableHead>
                  <TableHead className="text-right font-bold">Pagos</TableHead>
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
                    <TableCell className="text-right">{formatARS(r.sueldos)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.impuestos)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.comisionesBancarias)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.egresosMP)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.retirosSocios)}</TableCell>
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

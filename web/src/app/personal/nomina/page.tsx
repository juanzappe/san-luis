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

type Granularity = "mensual" | "trimestral" | "anual";

const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const QUARTER_LABELS: Record<string, string> = { "01": "Q1", "02": "Q1", "03": "Q1", "04": "Q2", "05": "Q2", "06": "Q2", "07": "Q3", "08": "Q3", "09": "Q3", "10": "Q4", "11": "Q4", "12": "Q4" };

interface AggRow {
  key: string;
  label: string;
  cantEmpleados: number;
  sueldosNetos: number;
  cargasSociales: number;
  costoTotal: number;
  costoPromedio: number;
  ingresos: number;
  pctSobreIngresos: number;
}

function aggregateNomina(data: NominaRow[], granularity: Granularity): AggRow[] {
  if (granularity === "mensual") {
    return [...data].map((r) => {
      const [y, m] = r.periodo.split("-");
      return {
        key: r.periodo,
        label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`,
        ...r,
      };
    }).sort((a, b) => b.key.localeCompare(a.key));
  }

  const buckets = new Map<string, { empSum: number; empCount: number; sueldos: number; cargas: number; costoTotal: number; ingresos: number }>();
  for (const r of data) {
    const [y, m] = r.periodo.split("-");
    const bucketKey = granularity === "trimestral" ? `${y}-${QUARTER_LABELS[m]}` : y;
    const cur = buckets.get(bucketKey) ?? { empSum: 0, empCount: 0, sueldos: 0, cargas: 0, costoTotal: 0, ingresos: 0 };
    cur.empSum += r.cantEmpleados;
    cur.empCount += 1;
    cur.sueldos += r.sueldosNetos;
    cur.cargas += r.cargasSociales;
    cur.costoTotal += r.costoTotal;
    cur.ingresos += r.ingresos;
    buckets.set(bucketKey, cur);
  }

  return Array.from(buckets.entries())
    .map(([k, v]) => {
      const avgEmp = v.empCount > 0 ? Math.round(v.empSum / v.empCount) : 0;
      const label = granularity === "trimestral"
        ? `${k.split("-")[1]} ${k.split("-")[0]}`
        : k;
      return {
        key: k,
        label,
        cantEmpleados: avgEmp,
        sueldosNetos: v.sueldos,
        cargasSociales: v.cargas,
        costoTotal: v.costoTotal,
        costoPromedio: avgEmp > 0 ? v.costoTotal / avgEmp : 0,
        ingresos: v.ingresos,
        pctSobreIngresos: v.ingresos > 0 ? (v.costoTotal / v.ingresos) * 100 : 0,
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
}

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
  const [granularity, setGranularity] = useState<Granularity>("mensual");
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

  // KPIs from last COMPLETE month (has both sueldos AND cargas)
  const kpis = useMemo(() => {
    if (data.length < 1) return null;
    // Find last month where both sueldos > 0 and cargasSociales > 0
    let lastIdx = data.length - 1;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].sueldosNetos > 0 && data[i].cargasSociales > 0) {
        lastIdx = i;
        break;
      }
    }
    const last = data[lastIdx];
    const prev = lastIdx >= 1 ? data[lastIdx - 1] : null;
    return {
      periodo: periodoLabel(last.periodo),
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
          <p className="text-muted-foreground">
            {kpis ? `Datos de ${kpis.periodo}` : "Evolución mensual de sueldos y cargas sociales"}
          </p>
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
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Detalle Mensual</CardTitle>
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
                  <TableHead className="text-right">Empleados</TableHead>
                  <TableHead className="text-right">Sueldos Netos</TableHead>
                  <TableHead className="text-right">Cargas Sociales</TableHead>
                  <TableHead className="text-right">Costo Total</TableHead>
                  <TableHead className="text-right">Costo Promedio</TableHead>
                  <TableHead className="text-right">% s/Ingresos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregateNomina(data, granularity).map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.label}</TableCell>
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

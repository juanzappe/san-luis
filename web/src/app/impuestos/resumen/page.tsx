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
  type ResumenMensualRow,
  fetchResumenFiscal,
  formatARS,
  formatPct,
  pctDelta,
  periodoLabel,
  shortLabel,
} from "@/lib/tax-queries";
import { InflationToggle, useInflation } from "@/lib/inflation";
import { MonthSelector } from "@/components/month-selector";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

type Granularity = "mensual" | "trimestral" | "anual";

const GRANULARITY_LABELS: Record<Granularity, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  anual: "Anual",
};

const QUARTER_MAP: Record<string, string> = {
  "01": "Q1", "02": "Q1", "03": "Q1",
  "04": "Q2", "05": "Q2", "06": "Q2",
  "07": "Q3", "08": "Q3", "09": "Q3",
  "10": "Q4", "11": "Q4", "12": "Q4",
};

interface AggRow {
  key: string;
  label: string;
  ivaNeto: number;
  gananciasEst: number;
  sicore: number;
  cheque: number;
  iibb: number;
  segHigiene: number;
  publicidad: number;
  espacioPublico: number;
  total: number;
  ingresos: number;
  presionFiscal: number | null;
}

function aggregateFiscal(
  rows: ResumenMensualRow[],
  granularity: Granularity,
): AggRow[] {
  if (granularity === "mensual") {
    return [...rows]
      .map((r) => ({
        key: r.periodo,
        label: periodoLabel(r.periodo),
        ...r,
      }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  const buckets = new Map<string, Omit<AggRow, "presionFiscal" | "label">>();
  for (const r of rows) {
    const [y, m] = r.periodo.split("-");
    const bucketKey = granularity === "trimestral" ? `${y}-${QUARTER_MAP[m]}` : y;
    const cur = buckets.get(bucketKey) ?? {
      key: bucketKey, ivaNeto: 0, gananciasEst: 0, sicore: 0, cheque: 0,
      iibb: 0, segHigiene: 0, publicidad: 0, espacioPublico: 0, total: 0, ingresos: 0,
    };
    cur.ivaNeto += r.ivaNeto;
    cur.gananciasEst += r.gananciasEst;
    cur.sicore += r.sicore;
    cur.cheque += r.cheque;
    cur.iibb += r.iibb;
    cur.segHigiene += r.segHigiene;
    cur.publicidad += r.publicidad;
    cur.espacioPublico += r.espacioPublico;
    cur.total += r.total;
    cur.ingresos += r.ingresos;
    buckets.set(bucketKey, cur);
  }

  return Array.from(buckets.values())
    .map((b) => ({
      ...b,
      label: b.key.includes("Q") ? `${b.key.split("-")[1]} ${b.key.split("-")[0]}` : b.key,
      presionFiscal: b.ingresos > 0 ? (b.total / b.ingresos) * 100 : null,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

const STACK_COLORS: Record<string, string> = {
  ivaNeto: "#3b82f6",
  gananciasEst: "#8b5cf6",
  sicore: "#a78bfa",
  cheque: "#ef4444",
  iibb: "#22c55e",
  segHigiene: "#f59e0b",
  publicidad: "#eab308",
  espacioPublico: "#86efac",
};

const PIE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6"];

function formatDateAR(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function KpiCard({ title, value, sub, subRaw, icon: Icon }: { title: string; value: string; sub?: string | null; subRaw?: string | null; icon: React.ElementType }) {
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
        {subRaw && (
          <p className="text-xs text-muted-foreground">{subRaw}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResumenFiscalPage() {
  const [raw, setRaw] = useState<ResumenFiscalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("mensual");
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
        ivaNeto: adjust(r.ivaNeto, r.periodo),
        gananciasEst: adjust(r.gananciasEst, r.periodo),
        sicore: adjust(r.sicore, r.periodo),
        cheque: adjust(r.cheque, r.periodo),
        iibb: adjust(r.iibb, r.periodo),
        segHigiene: adjust(r.segHigiene, r.periodo),
        publicidad: adjust(r.publicidad, r.periodo),
        espacioPublico: adjust(r.espacioPublico, r.periodo),
        total: adjust(r.total, r.periodo),
        ingresos: adjust(r.ingresos, r.periodo),
      })),
    };
  }, [raw, adjust]);

  // Month selector for KPIs
  const [selectedPeriodo, setSelectedPeriodo] = useState("");
  const fiscalPeriodos = useMemo(() => (data?.mensual ?? []).map((r) => r.periodo), [data]);
  const defaultPeriodo = useMemo(() => {
    if (!data) return "";
    for (let i = data.mensual.length - 1; i >= 0; i--) {
      if (data.mensual[i].total > 0) return data.mensual[i].periodo;
    }
    return data.mensual[data.mensual.length - 1]?.periodo ?? "";
  }, [data]);
  const activePeriodo = selectedPeriodo || defaultPeriodo;

  const kpis = useMemo(() => {
    if (!data || data.mensual.length < 1) return null;
    const lastIdx = data.mensual.findIndex((r) => r.periodo === activePeriodo);
    if (lastIdx < 0) return null;
    const last = data.mensual[lastIdx];
    const prev = lastIdx >= 1 ? data.mensual[lastIdx - 1] : null;
    return {
      total: last.total,
      deltaTotal: prev ? pctDelta(last.total, prev.total) : null,
      presion: last.presionFiscal,
      deltaPresion: prev && last.presionFiscal != null && prev.presionFiscal != null
        ? pctDelta(last.presionFiscal, prev.presionFiscal) : null,
      posIva: last.ivaNeto,
      deltaIva: prev ? pctDelta(last.ivaNeto, prev.ivaNeto) : null,
    };
  }, [data, activePeriodo]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.mensual.slice(-24).map((r) => ({
      label: shortLabel(r.periodo),
      ivaNeto: r.ivaNeto,
      gananciasEst: r.gananciasEst,
      sicore: r.sicore,
      cheque: r.cheque,
      iibb: r.iibb,
      segHigiene: r.segHigiene,
      publicidad: r.publicidad,
      espacioPublico: r.espacioPublico,
      presionFiscal: r.presionFiscal ?? undefined,
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
        <div className="flex items-center gap-2">
          <MonthSelector periodos={fiscalPeriodos} value={activePeriodo} onChange={setSelectedPeriodo} />
          <InflationToggle />
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Impuestos del Mes" value={formatARS(kpis.total)} sub={kpis.deltaTotal != null ? formatPct(kpis.deltaTotal) : null} icon={DollarSign} />
          <KpiCard title="Presión Fiscal" value={kpis.presion != null ? `${kpis.presion.toFixed(1)}%` : "—"} sub={kpis.deltaPresion != null ? formatPct(kpis.deltaPresion) : null} icon={Percent} />
          <KpiCard title="IVA Pos. Neta" value={formatARS(kpis.posIva)} sub={kpis.deltaIva != null ? formatPct(kpis.deltaIva) : null} icon={Receipt} />
          {data.proximoVto ? (
            <KpiCard title="Próximo Vencimiento" value={data.proximoVto.impuesto} subRaw={formatDateAR(data.proximoVto.fecha)} icon={CalendarClock} />
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
                <Bar dataKey="ivaNeto" name="IVA Neto" stackId="a" fill={STACK_COLORS.ivaNeto} />
                <Bar dataKey="gananciasEst" name="Ganancias*" stackId="a" fill={STACK_COLORS.gananciasEst} />
                <Bar dataKey="sicore" name="Ret./SICORE" stackId="a" fill={STACK_COLORS.sicore} />
                <Bar dataKey="cheque" name="Imp. Cheque" stackId="a" fill={STACK_COLORS.cheque} />
                <Bar dataKey="iibb" name="IIBB" stackId="a" fill={STACK_COLORS.iibb} />
                <Bar dataKey="segHigiene" name="Seg. e Higiene" stackId="a" fill={STACK_COLORS.segHigiene} />
                <Bar dataKey="publicidad" name="Publicidad" stackId="a" fill={STACK_COLORS.publicidad} />
                <Bar dataKey="espacioPublico" name="Esp. Público" stackId="a" fill={STACK_COLORS.espacioPublico} radius={[4, 4, 0, 0]} />
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
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Detalle {GRANULARITY_LABELS[granularity]}</CardTitle>
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
                  <TableHead className="text-right">IVA Neto</TableHead>
                  <TableHead className="text-right">Ganancias*</TableHead>
                  <TableHead className="text-right">SICORE</TableHead>
                  <TableHead className="text-right">Cheque</TableHead>
                  <TableHead className="text-right">IIBB</TableHead>
                  <TableHead className="text-right">Seg. e Hig.</TableHead>
                  <TableHead className="text-right">Publicidad</TableHead>
                  <TableHead className="text-right">Esp. Público</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Ingresos</TableHead>
                  <TableHead className="text-right">Presión %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregateFiscal(data.mensual, granularity).map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium whitespace-nowrap">{r.label}</TableCell>
                    <TableCell className="text-right">{formatARS(r.ivaNeto)}</TableCell>
                    <TableCell className="text-right italic">{formatARS(r.gananciasEst)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.sicore)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cheque)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.iibb)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.segHigiene)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.publicidad)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.espacioPublico)}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(r.total)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.ingresos)}</TableCell>
                    <TableCell className="text-right">{r.presionFiscal != null ? `${r.presionFiscal.toFixed(1)}%` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground italic">* Ganancias estimado (35% del resultado neto positivo)</p>
        </CardContent>
      </Card>
    </div>
  );
}

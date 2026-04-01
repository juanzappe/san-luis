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
import { Loader2, AlertCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type PagoImpuestoRow,
  fetchPagosImpuestos,
  formatARS,
  shortLabel,
  periodoLabel,
} from "@/lib/tax-queries";
import { InflationToggle, useInflation } from "@/lib/inflation";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

// ---------------------------------------------------------------------------
// Observaciones parser
// ---------------------------------------------------------------------------

interface ParsedObs {
  codigoImpuesto: number | null;
  nombreImpuesto: string;
  periodoFiscal: string; // "YYYYMM"
  tipoComprobante: string;
}

const OBS_RE = /Impuesto:\s*(\d+)\s*-\s*([^|]+)\|\s*Per[ií]odo:\s*(\d+)\s*\|?\s*(.*)/;

function parseObservaciones(obs: string): ParsedObs {
  const m = obs.match(OBS_RE);
  if (!m) return { codigoImpuesto: null, nombreImpuesto: obs || "—", periodoFiscal: "", tipoComprobante: "" };
  return {
    codigoImpuesto: parseInt(m[1], 10),
    nombreImpuesto: m[2].trim(),
    periodoFiscal: m[3].slice(0, 6), // YYYYMM
    tipoComprobante: m[4].trim(),
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const CODIGO_LABELS: Record<number, string> = {
  30: "IVA",
  217: "SICORE/Ganancias",
  10: "Ganancias",
  11: "Ganancias",
  301: "Aportes Seg. Social",
  302: "Aportes Obra Social",
  312: "ART",
  351: "Contribuciones Seg. Social",
  352: "Contribuciones Obra Social",
  28: "Seguro de Vida Colectivo",
};

type Categoria = "Impuestos" | "Cargas Sociales";

const CARGAS_SOCIALES_CODIGOS = new Set([301, 302, 312, 351, 352, 28]);

function classifyPago(parsed: ParsedObs, formulario: string): { label: string; categoria: Categoria } {
  const code = parsed.codigoImpuesto;
  if (formulario === "931" || (code !== null && CARGAS_SOCIALES_CODIGOS.has(code))) {
    return { label: code !== null && CODIGO_LABELS[code] ? CODIGO_LABELS[code] : parsed.nombreImpuesto, categoria: "Cargas Sociales" };
  }
  if (code !== null && CODIGO_LABELS[code]) {
    return { label: CODIGO_LABELS[code], categoria: "Impuestos" };
  }
  return { label: parsed.nombreImpuesto || "Nacional - Otro", categoria: "Impuestos" };
}

// ---------------------------------------------------------------------------
// Enriched row
// ---------------------------------------------------------------------------

interface EnrichedPago {
  id: number;
  fechaPago: string;       // YYYY-MM-DD
  fechaPagoLabel: string;  // DD/MM/YYYY
  impuestoLabel: string;
  codigo: number | null;
  periodoFiscalLabel: string;
  formulario: string;
  formularioLabel: string;
  monto: number;
  categoria: Categoria;
  // for charts
  chartGroup: string; // simplified grouping for stacked bars
}

const MONTH_NAMES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function periodoFiscalToLabel(pf: string): string {
  if (!pf || pf.length < 6) return pf || "—";
  const y = pf.slice(0, 4);
  const m = parseInt(pf.slice(4, 6), 10);
  if (m < 1 || m > 12) return pf;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function formatDateAR(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function enrichPagos(raw: PagoImpuestoRow[]): EnrichedPago[] {
  return raw.map((p) => {
    const parsed = parseObservaciones(p.concepto);
    const { label, categoria } = classifyPago(parsed, p.concepto.includes("931") ? "931" : (p.concepto.includes("800") ? "800" : ""));
    // Derive formulario from observaciones or from the raw formulario field
    const formMatch = p.concepto.match(/F\.?\s*(\d{3,4})/i);
    const rawForm = formMatch ? formMatch[1] : "";
    // Better: check if it's F.931 or F.800 pattern
    let formulario = rawForm;
    if (!formulario) {
      // Fallback: cargas sociales → 931, impuestos → 800
      if (categoria === "Cargas Sociales") formulario = "931";
      else formulario = "800";
    }

    // Chart grouping: IVA, SICORE, Cargas Sociales, Otro
    let chartGroup = label;
    if (CARGAS_SOCIALES_CODIGOS.has(parsed.codigoImpuesto ?? 0)) chartGroup = "Cargas Sociales";

    return {
      id: p.id,
      fechaPago: p.fechaPago,
      fechaPagoLabel: formatDateAR(p.fechaPago),
      impuestoLabel: label,
      codigo: parsed.codigoImpuesto,
      periodoFiscalLabel: periodoFiscalToLabel(parsed.periodoFiscal),
      formulario,
      formularioLabel: formulario ? `F.${formulario}` : "—",
      monto: p.monto,
      categoria,
      chartGroup,
    };
  }).sort((a, b) => b.fechaPago.localeCompare(a.fechaPago));
}

// ---------------------------------------------------------------------------
// Period aggregation
// ---------------------------------------------------------------------------

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

interface AggPagoRow {
  key: string;
  label: string;
  impuestos: number;
  cargasSociales: number;
  total: number;
}

function aggregatePagos(rows: EnrichedPago[], granularity: Granularity, adjust: (m: number, p: string) => number): AggPagoRow[] {
  const buckets = new Map<string, { impuestos: number; cargasSociales: number }>();

  for (const r of rows) {
    const m = r.fechaPago.slice(0, 7); // YYYY-MM
    const [y, mm] = m.split("-");
    const bucketKey = granularity === "mensual" ? m : granularity === "trimestral" ? `${y}-${QUARTER_MAP[mm]}` : y;
    const cur = buckets.get(bucketKey) ?? { impuestos: 0, cargasSociales: 0 };
    const adjusted = adjust(r.monto, m);
    if (r.categoria === "Cargas Sociales") cur.cargasSociales += adjusted;
    else cur.impuestos += adjusted;
    buckets.set(bucketKey, cur);
  }

  return Array.from(buckets.entries())
    .map(([key, v]) => {
      let label: string;
      if (granularity === "mensual") label = periodoLabel(key);
      else if (granularity === "trimestral") label = `${key.split("-")[1]} ${key.split("-")[0]}`;
      else label = key;
      return { key, label, impuestos: v.impuestos, cargasSociales: v.cargasSociales, total: v.impuestos + v.cargasSociales };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
}

// ---------------------------------------------------------------------------
// Chart colors
// ---------------------------------------------------------------------------

const CHART_GROUP_COLORS: Record<string, string> = {
  "IVA": "#3b82f6",
  "SICORE/Ganancias": "#8b5cf6",
  "Ganancias": "#a78bfa",
  "Cargas Sociales": "#f59e0b",
  "Nacional - Otro": "#6366f1",
};

function chartColor(group: string): string {
  return CHART_GROUP_COLORS[group] ?? "#94a3b8";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function PagosPage() {
  const [raw, setRaw] = useState<PagoImpuestoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string>("Todos");
  const [impFilter, setImpFilter] = useState<string>("Todos");
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const { adjust } = useInflation();

  useEffect(() => {
    fetchPagosImpuestos()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Enrich all rows
  const enriched = useMemo(() => enrichPagos(raw), [raw]);

  // Dynamic impuesto labels
  const impuestoLabels = useMemo(() => {
    const set = new Set<string>();
    for (const p of enriched) set.add(p.impuestoLabel);
    return Array.from(set).sort();
  }, [enriched]);

  // Filtered data
  const filtered = useMemo(() => {
    let d = enriched;
    if (catFilter !== "Todos") d = d.filter((p) => p.categoria === catFilter);
    if (impFilter !== "Todos") d = d.filter((p) => p.impuestoLabel === impFilter);
    return d;
  }, [enriched, catFilter, impFilter]);

  // Stacked bar chart by chart group (monthly, by fecha_pago)
  const stackedChart = useMemo(() => {
    // Get unique chart groups
    const groups = new Set<string>();
    filtered.forEach((p) => groups.add(p.chartGroup));
    const groupList = Array.from(groups).sort();

    const map = new Map<string, Record<string, number>>();
    for (const p of filtered) {
      const m = p.fechaPago.slice(0, 7);
      if (!map.has(m)) {
        const row: Record<string, number> = {};
        for (const g of groupList) row[g] = 0;
        map.set(m, row);
      }
      const row = map.get(m)!;
      row[p.chartGroup] = (row[p.chartGroup] ?? 0) + adjust(p.monto, m);
    }

    const data = Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-24)
      .map(([periodo, vals]) => ({ label: shortLabel(periodo), ...vals }));

    return { data, groups: groupList };
  }, [filtered, adjust]);

  // Line chart: monthly total
  const lineChart = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of filtered) {
      const m = p.fechaPago.slice(0, 7);
      map.set(m, (map.get(m) ?? 0) + adjust(p.monto, m));
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-24)
      .map(([periodo, monto]) => ({ label: shortLabel(periodo), monto }));
  }, [filtered, adjust]);

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
        <p className="mt-3 font-medium">Sin pagos de impuestos</p>
        <p className="text-sm text-muted-foreground">Importá datos de pagos para ver el historial.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Historial de Pagos</h1>
          <p className="text-muted-foreground">Pagos registrados por fecha de pago (criterio percibido)</p>
        </div>
        <InflationToggle />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo</label>
          <div className="flex gap-1">
            {["Todos", "Impuestos", "Cargas Sociales"].map((c) => (
              <button
                key={c}
                onClick={() => { setCatFilter(c); setImpFilter("Todos"); }}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  catFilter === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Impuesto</label>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setImpFilter("Todos")}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                impFilter === "Todos" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              Todos
            </button>
            {impuestoLabels.map((l) => (
              <button
                key={l}
                onClick={() => setImpFilter(l)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  impFilter === l ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Pagos Mensuales</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stackedChart.data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                {stackedChart.groups.map((g, i) => (
                  <Bar
                    key={g}
                    dataKey={g}
                    name={g}
                    stackId="a"
                    fill={chartColor(g)}
                    radius={i === stackedChart.groups.length - 1 ? [4, 4, 0, 0] : undefined}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Evolución</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={lineChart}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Line type="monotone" dataKey="monto" name="Total" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Detail table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            Detalle de Pagos
            <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length} registros)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha Pago</TableHead>
                  <TableHead>Impuesto</TableHead>
                  <TableHead className="text-right">Código</TableHead>
                  <TableHead>Período Fiscal</TableHead>
                  <TableHead>Formulario</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 200).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{p.fechaPagoLabel}</TableCell>
                    <TableCell>{p.impuestoLabel}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{p.codigo ?? "—"}</TableCell>
                    <TableCell>{p.periodoFiscalLabel}</TableCell>
                    <TableCell>{p.formularioLabel}</TableCell>
                    <TableCell className="text-right font-medium">{formatARS(adjust(p.monto, p.fechaPago.slice(0, 7)))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length > 200 && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Mostrando los primeros 200 de {filtered.length} pagos
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Aggregated table with period selector */}
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
                  <TableHead className="text-right">Impuestos</TableHead>
                  <TableHead className="text-right">Cargas Sociales</TableHead>
                  <TableHead className="text-right font-bold">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregatePagos(filtered, granularity, adjust).map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium whitespace-nowrap">{r.label}</TableCell>
                    <TableCell className="text-right">{formatARS(r.impuestos)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.cargasSociales)}</TableCell>
                    <TableCell className="text-right font-bold">{formatARS(r.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground italic">
        Datos basados en VEPs de ARCA. No incluye pagos provinciales ni municipales.
      </p>
    </div>
  );
}

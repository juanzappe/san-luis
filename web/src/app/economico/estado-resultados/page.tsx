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
  Cell,
  ReferenceLine,
} from "recharts";
import { Loader2, AlertCircle, Info } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type ResultadoRow,
  fetchResultado,
  formatARS,
  periodoLabel,
  shortLabel,
  TASA_GANANCIAS,
} from "@/lib/economic-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

// Datos de estados contables auditados (hardcoded)
// RECPAM puro — positive = pérdida por inflación (se resta), negative = ganancia (se suma)
const RECPAM_HISTORICO: Record<string, number> = {
  "2024": 364599000,
  "2023": 496052700,
  "2022": -61205150,
  "2021": -69080530,
};
// Ratio RECPAM/Ingresos 2024 para estimar meses sin auditoría
const RATIO_RECPAM = 0.218;

// Amortizaciones anuales de estados contables auditados
const AMORTIZACIONES_ANUAL: Record<string, number> = {
  "2024": 32205313,
  "2023": 30166319,
  "2022": 23218786,
  "2021": 18171378,
};
// Base mensual para 2025+ (2024 / 12)
const AMORT_MENSUAL_BASE = 32205313 / 12;

// ---------------------------------------------------------------------------
// Extended row type with RECPAM and Amortizaciones
// ---------------------------------------------------------------------------
interface ExtendedResultadoRow extends ResultadoRow {
  recpam: number;
  recpamEstimado: boolean;
  amortizaciones: number;
  ebitda: number;
}

// ---------------------------------------------------------------------------
// Period aggregation
// ---------------------------------------------------------------------------
type Granularity = "mensual" | "trimestral" | "anual";

const QUARTER_MAP: Record<string, string> = {
  "01": "Q1", "02": "Q1", "03": "Q1",
  "04": "Q2", "05": "Q2", "06": "Q2",
  "07": "Q3", "08": "Q3", "09": "Q3",
  "10": "Q4", "11": "Q4", "12": "Q4",
};

function aggregateResultado(
  data: ExtendedResultadoRow[],
  granularity: Granularity,
): ExtendedResultadoRow[] {
  if (granularity === "mensual") return data;

  const buckets = new Map<string, ExtendedResultadoRow>();
  for (const r of data) {
    const [y, m] = r.periodo.split("-");
    const key = granularity === "trimestral" ? `${y}-${QUARTER_MAP[m]}` : y;
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, { ...r, periodo: key });
    } else {
      cur.ingresos += r.ingresos;
      cur.costosOperativos += r.costosOperativos;
      cur.sueldos += r.sueldos;
      cur.costosComercialesAdmin += r.costosComercialesAdmin;
      cur.costosFinancieros += r.costosFinancieros;
      cur.recpam += r.recpam;
      cur.recpamEstimado = cur.recpamEstimado || r.recpamEstimado;
      cur.amortizaciones += r.amortizaciones;
      cur.ganancias += r.ganancias;
      cur.margenBruto += r.margenBruto;
      cur.ebitda = cur.margenBruto + cur.amortizaciones;
      cur.resultadoAntesGanancias += r.resultadoAntesGanancias;
      cur.resultadoNeto += r.resultadoNeto;
      cur.margenPct = cur.ingresos > 0 ? (cur.resultadoNeto / cur.ingresos) * 100 : 0;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.periodo.localeCompare(b.periodo));
}

function granularityLabel(p: string, g: Granularity): string {
  if (g === "anual") return p;
  if (g === "trimestral") {
    const [y, q] = p.split("-");
    return `${q} ${y}`;
  }
  return periodoLabel(p);
}

// ---------------------------------------------------------------------------
// P&L line item component
// ---------------------------------------------------------------------------
function PnlLine({
  label,
  values,
  bold,
  border,
  indent,
  negative,
  infoTip,
  annotations,
}: {
  label: string;
  values: number[];
  bold?: boolean;
  border?: boolean;
  indent?: boolean;
  negative?: boolean;
  infoTip?: string;
  annotations?: (string | null)[];
}) {
  return (
    <TableRow className={border ? "border-t-2 border-foreground/20" : ""}>
      <TableCell className={`${bold ? "font-bold" : ""} ${indent ? "pl-8" : ""}`}>
        <span className="inline-flex items-center gap-1">
          {negative && !bold ? `(−) ${label}` : label}
          {infoTip && (
            <span title={infoTip} className="cursor-help">
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          )}
        </span>
      </TableCell>
      {values.map((v, i) => (
        <TableCell
          key={i}
          className={`text-right ${bold ? "font-bold" : ""} ${
            v < 0 ? "text-red-600" : ""
          } ${annotations?.[i] ? "italic" : ""}`}
        >
          {formatARS(Math.abs(v))}
          {annotations?.[i] && (
            <span className="text-muted-foreground ml-0.5" title={annotations[i]!}>*</span>
          )}
        </TableCell>
      ))}
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Waterfall chart data builder
// ---------------------------------------------------------------------------
interface WaterfallBar {
  name: string;
  base: number; // invisible base
  value: number; // visible bar
  total?: boolean;
  color: string;
}

function buildWaterfall(row: ExtendedResultadoRow): WaterfallBar[] {
  const bars: WaterfallBar[] = [];
  let running = 0;

  // Ingresos (starts from 0)
  bars.push({ name: "Ingresos", base: 0, value: row.ingresos, color: "#22c55e" });
  running = row.ingresos;

  // Costos operativos — proveedores only (subtract)
  bars.push({
    name: "C. Operativos",
    base: running - row.costosOperativos,
    value: row.costosOperativos,
    color: "#ef4444",
  });
  running -= row.costosOperativos;

  // Sueldos (subtract)
  bars.push({
    name: "Sueldos",
    base: running - row.sueldos,
    value: row.sueldos,
    color: "#6366f1",
  });
  running -= row.sueldos;

  // Margen bruto (subtotal)
  bars.push({ name: "Margen Bruto", base: 0, value: running, total: true, color: running >= 0 ? "#22c55e" : "#ef4444" });

  // Costos comerciales
  bars.push({
    name: "C. Comerciales",
    base: running - row.costosComercialesAdmin,
    value: row.costosComercialesAdmin,
    color: "#f59e0b",
  });
  running -= row.costosComercialesAdmin;

  // Costos financieros
  bars.push({
    name: "C. Financieros",
    base: running - row.costosFinancieros,
    value: row.costosFinancieros,
    color: "#3b82f6",
  });
  running -= row.costosFinancieros;

  // RECPAM — positive subtracts (desfavorable), negative adds (favorable)
  if (row.recpam > 0) {
    bars.push({
      name: "RECPAM",
      base: running - row.recpam,
      value: row.recpam,
      color: "#f97316",
    });
  } else if (row.recpam < 0) {
    bars.push({
      name: "RECPAM",
      base: running,
      value: Math.abs(row.recpam),
      color: "#22c55e",
    });
  }
  running -= row.recpam;

  // Ganancias
  bars.push({
    name: "Ganancias",
    base: running - row.ganancias,
    value: row.ganancias,
    color: "#8b5cf6",
  });
  running -= row.ganancias;

  // Resultado neto (final total)
  bars.push({
    name: "Resultado",
    base: 0,
    value: running,
    total: true,
    color: running >= 0 ? "#22c55e" : "#ef4444",
  });

  return bars;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function EstadoResultadosPage() {
  const { adjust } = useInflation();
  const [raw, setRaw] = useState<ResultadoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("mensual");

  useEffect(() => {
    fetchResultado()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Adjust for inflation + compute RECPAM, Amortizaciones, EBITDA
  const data: ExtendedResultadoRow[] = useMemo(
    () =>
      raw.map((r) => {
        const year = r.periodo.split("-")[0];
        const ing = adjust(r.ingresos, r.periodo);
        const costOp = adjust(r.costosOperativos, r.periodo);
        const sueldos = adjust(r.sueldos, r.periodo);
        const costCom = adjust(r.costosComercialesAdmin, r.periodo);
        const costFin = adjust(r.costosFinancieros, r.periodo);
        const margenBruto = ing - costOp - sueldos;

        // RECPAM: historical (distributed monthly) or estimated via ratio
        let recpamNominal: number;
        let recpamEstimado: boolean;
        if (year in RECPAM_HISTORICO) {
          recpamNominal = RECPAM_HISTORICO[year] / 12;
          recpamEstimado = false;
        } else {
          recpamNominal = r.ingresos * RATIO_RECPAM;
          recpamEstimado = true;
        }
        const recpam = adjust(recpamNominal, r.periodo);

        // Amortizaciones: historical (distributed monthly) or base 2024
        const amortNominal = year in AMORTIZACIONES_ANUAL
          ? AMORTIZACIONES_ANUAL[year] / 12
          : AMORT_MENSUAL_BASE;
        const amortizaciones = adjust(amortNominal, r.periodo);

        const ebitda = margenBruto + amortizaciones;
        const resAntesGan = margenBruto - costCom - costFin - recpam;
        const gan = resAntesGan > 0 ? resAntesGan * TASA_GANANCIAS : 0;
        const resNeto = resAntesGan - gan;
        const margenPct = ing > 0 ? (resNeto / ing) * 100 : 0;

        return {
          periodo: r.periodo,
          ingresos: ing,
          costosOperativos: costOp,
          sueldos,
          margenBruto,
          costosComercialesAdmin: costCom,
          costosFinancieros: costFin,
          recpam,
          recpamEstimado,
          amortizaciones,
          ebitda,
          resultadoAntesGanancias: resAntesGan,
          ganancias: gan,
          resultadoNeto: resNeto,
          margenPct,
        };
      }),
    [raw, adjust],
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
      <Card>
        <CardContent className="flex items-center gap-3 py-8">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <p className="text-sm">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium">Sin datos para el estado de resultados</p>
          <p className="text-sm text-muted-foreground">
            Ejecutá el ETL para importar ventas, egresos e impuestos.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Aggregate by selected granularity and take last N periods for table
  const aggregated = aggregateResultado(data, granularity);
  const tableCount = granularity === "mensual" ? 6 : granularity === "trimestral" ? 8 : 4;
  const tablePeriods = aggregated.slice(-tableCount);
  const lastRow = data[data.length - 1];
  const waterfall = buildWaterfall(lastRow);

  // Margin evolution (last 12 months)
  const marginData = data.slice(-12).map((r) => ({
    label: shortLabel(r.periodo),
    margen: r.margenPct,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Estado de Resultados</h1>
          <p className="text-muted-foreground">
            Calculado desde datos operativos
          </p>
        </div>
        <InflationToggle />
      </div>

      {/* P&L Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Estado de Resultados</CardTitle>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Concepto</TableHead>
                {tablePeriods.map((r) => (
                  <TableHead key={r.periodo} className="text-right">
                    {granularityLabel(r.periodo, granularity)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <PnlLine
                label="Ingresos Netos"
                values={tablePeriods.map((r) => r.ingresos)}
                bold
              />
              <PnlLine
                label="Costos Operativos"
                values={tablePeriods.map((r) => r.costosOperativos)}
                indent
                negative
              />
              <PnlLine
                label="Sueldos"
                values={tablePeriods.map((r) => r.sueldos)}
                indent
                negative
              />
              <PnlLine
                label="Margen Bruto"
                values={tablePeriods.map((r) => r.margenBruto)}
                bold
                border
              />
              <PnlLine
                label="EBITDA"
                values={tablePeriods.map((r) => r.ebitda)}
                bold
                infoTip={`EBITDA = Margen Bruto + Amortizaciones (~${formatARS(AMORT_MENSUAL_BASE)}/mes base 2024). Datos de estados contables auditados para 2021-2024.`}
              />
              <PnlLine
                label="Costos Comerciales"
                values={tablePeriods.map((r) => r.costosComercialesAdmin)}
                indent
                negative
              />
              <PnlLine
                label="Costos Financieros"
                values={tablePeriods.map((r) => r.costosFinancieros)}
                indent
                negative
              />
              <PnlLine
                label="RECPAM"
                values={tablePeriods.map((r) => r.recpam)}
                indent
                negative
                infoTip="Resultado por exposición al cambio en el poder adquisitivo de la moneda. Datos auditados 2021-2024, estimado al 21.8% de ingresos para períodos posteriores."
                annotations={tablePeriods.map((r) =>
                  r.recpamEstimado ? `Estimado al ${(RATIO_RECPAM * 100).toFixed(1)}% de ingresos (ratio 2024)` : null
                )}
              />
              <PnlLine
                label="Resultado antes de Ganancias"
                values={tablePeriods.map((r) => r.resultadoAntesGanancias)}
                bold
                border
              />
              <PnlLine
                label="Imp. a las Ganancias"
                values={tablePeriods.map((r) => r.ganancias)}
                indent
                negative
                infoTip={`Estimado al ${(TASA_GANANCIAS * 100).toFixed(1)}% (tasa efectiva promedio 2023-2024). No incluye diferencias temporarias ni ajuste por inflación impositiva.`}
              />
              <PnlLine
                label="Resultado Neto"
                values={tablePeriods.map((r) => r.resultadoNeto)}
                bold
                border
              />
              {/* Margin % row */}
              <TableRow className="border-t">
                <TableCell className="italic text-muted-foreground">Margen neto %</TableCell>
                {tablePeriods.map((r) => (
                  <TableCell
                    key={r.periodo}
                    className={`text-right italic ${
                      r.margenPct >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {r.margenPct.toFixed(1)}%
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Ingresos vs Egresos & Resultado Neto — 2 column */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Ingresos vs Egresos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ingresos vs Egresos</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={tablePeriods.map((r) => ({
                  label: granularityLabel(r.periodo, granularity),
                  ingresos: r.ingresos,
                  egresos: r.costosOperativos + r.sueldos + r.costosComercialesAdmin + r.costosFinancieros + Math.max(0, r.recpam) + r.ganancias,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Bar dataKey="ingresos" name="Ingresos Netos" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="egresos" name="Total Egresos" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Resultado Neto */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {granularity === "mensual" ? "Resultado Neto Mensual" : granularity === "trimestral" ? "Resultado Neto Trimestral" : "Resultado Neto Anual"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={tablePeriods.map((r) => ({
                  label: granularityLabel(r.periodo, granularity),
                  resultado: r.resultadoNeto,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <ReferenceLine y={0} stroke="#666" />
                <Bar dataKey="resultado" name="Resultado Neto" radius={[4, 4, 0, 0]}>
                  {tablePeriods.map((r, i) => (
                    <Cell key={i} fill={r.resultadoNeto >= 0 ? "#22c55e" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts — 2 column */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Waterfall */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Cascada — {periodoLabel(lastRow.periodo)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={waterfall}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <ReferenceLine y={0} stroke="#666" />
                {/* Invisible base */}
                <Bar dataKey="base" stackId="w" fill="transparent" />
                {/* Visible value */}
                <Bar dataKey="value" stackId="w" radius={[4, 4, 0, 0]}>
                  {waterfall.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Margin evolution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evolución del Margen Neto</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={marginData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip
                  formatter={((v: ValueType | undefined) => `${Number(v ?? 0).toFixed(1)}%`) as Formatter<ValueType, NameType>}
                />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="margen"
                  name="Margen neto %"
                  stroke="#ec4899"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

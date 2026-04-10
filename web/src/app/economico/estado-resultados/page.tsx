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
  RECPAM_HISTORICO,
  RATIO_PMN,
  computeIpcFallback,
} from "@/lib/economic-queries";
import { fetchResumenFiscal, computeGastosComerciales, type ResumenMensualRow } from "@/lib/tax-queries";
import { fetchIpcMensualMap } from "@/lib/macro-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

// RECPAM_HISTORICO, RATIO_PMN, INFLACION_FALLBACK_PCT importados de economic-queries
// (fuente única compartida con egresos/page.tsx)

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
  recpamConIpcReal: boolean; // true = usó inflación mensual real de la tabla
  amortizaciones: number;
  ebitda: number;
}

// ---------------------------------------------------------------------------
// Period aggregation
// ---------------------------------------------------------------------------
type Granularity = "mensual" | "trimestral" | "anual" | "ytd";

const QUARTER_MAP: Record<string, string> = {
  "01": "Q1", "02": "Q1", "03": "Q1",
  "04": "Q2", "05": "Q2", "06": "Q2",
  "07": "Q3", "08": "Q3", "09": "Q3",
  "10": "Q4", "11": "Q4", "12": "Q4",
};

const MONTH_SHORT: Record<string, string> = {
  "01": "Ene", "02": "Feb", "03": "Mar", "04": "Abr",
  "05": "May", "06": "Jun", "07": "Jul", "08": "Ago",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dic",
};

function aggregateResultado(
  data: ExtendedResultadoRow[],
  granularity: Granularity,
  ytdLastMonth?: number,
): ExtendedResultadoRow[] {
  if (granularity === "mensual") return data;

  // For YTD: filter to months 1..N before aggregating by year
  let source = data;
  if (granularity === "ytd" && ytdLastMonth) {
    source = data.filter((r) => {
      const m = parseInt(r.periodo.split("-")[1], 10);
      return m >= 1 && m <= ytdLastMonth;
    });
  }

  const buckets = new Map<string, ExtendedResultadoRow>();
  for (const r of source) {
    const [y, m] = r.periodo.split("-");
    const key = granularity === "trimestral" ? `${y}-${QUARTER_MAP[m]}` : y;
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, { ...r, periodo: key });
    } else {
      cur.ingresos += r.ingresos;
      cur.costosOperativos += r.costosOperativos;
      cur.sueldos += r.sueldos;
      cur.cargasSociales += r.cargasSociales;
      cur.costosComercialesAdmin += r.costosComercialesAdmin;
      cur.costosFinancieros += r.costosFinancieros;
      cur.recpam += r.recpam;
      cur.recpamEstimado = cur.recpamEstimado || r.recpamEstimado;
      cur.recpamConIpcReal = cur.recpamConIpcReal || r.recpamConIpcReal;
      cur.amortizaciones += r.amortizaciones;
      cur.ganancias += r.ganancias; // summed monthly; recalculated below
      cur.margenBruto += r.margenBruto;
      cur.ebitda = cur.margenBruto + cur.amortizaciones;
      cur.resultadoAntesGanancias += r.resultadoAntesGanancias;
      cur.resultadoNeto += r.resultadoNeto;
      cur.margenPct = cur.ingresos > 0 ? (cur.resultadoNeto / cur.ingresos) * 100 : 0;
    }
  }

  // Recalculate ganancias on the aggregated base to avoid inflated rates
  // (monthly clamping at 0 inflates the annual sum when some months are negative)
  Array.from(buckets.values()).forEach((cur) => {
    cur.ganancias = cur.resultadoAntesGanancias > 0
      ? cur.resultadoAntesGanancias * TASA_GANANCIAS
      : 0;
    cur.resultadoNeto = cur.resultadoAntesGanancias - cur.ganancias;
    cur.margenPct = cur.ingresos > 0 ? (cur.resultadoNeto / cur.ingresos) * 100 : 0;
  });
  return Array.from(buckets.values()).sort((a, b) => a.periodo.localeCompare(b.periodo));
}

function granularityLabel(p: string, g: Granularity, ytdLastMonth?: number): string {
  if (g === "anual") return p;
  if (g === "ytd" && ytdLastMonth) {
    return `Ene-${MONTH_SHORT[String(ytdLastMonth).padStart(2, "0")] ?? ytdLastMonth} ${p}`;
  }
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

function buildAnnualWaterfall(row: ExtendedResultadoRow): WaterfallBar[] {
  const bars: WaterfallBar[] = [];
  let running = 0;

  bars.push({ name: "Ingresos Netos", base: 0, value: row.ingresos, color: "#22c55e" });
  running = row.ingresos;

  bars.push({ name: "C. Operativos", base: running - row.costosOperativos, value: row.costosOperativos, color: "#ef4444" });
  running -= row.costosOperativos;

  const sueldosCS = row.sueldos + row.cargasSociales;
  bars.push({ name: "Sueldos y CS", base: running - sueldosCS, value: sueldosCS, color: "#ef4444" });
  running -= sueldosCS;

  // Subtotal: Margen Bruto (from 0)
  bars.push({ name: "Margen Bruto", base: 0, value: running, total: true, color: running >= 0 ? "#22c55e" : "#ef4444" });

  bars.push({ name: "C. Comerciales", base: running - row.costosComercialesAdmin, value: row.costosComercialesAdmin, color: "#ef4444" });
  running -= row.costosComercialesAdmin;

  bars.push({ name: "C. Financieros", base: running - row.costosFinancieros, value: row.costosFinancieros, color: "#ef4444" });
  running -= row.costosFinancieros;

  if (row.recpam !== 0) {
    if (row.recpam > 0) {
      bars.push({ name: "RECPAM", base: running - row.recpam, value: row.recpam, color: "#ef4444" });
    } else {
      bars.push({ name: "RECPAM", base: running, value: Math.abs(row.recpam), color: "#22c55e" });
    }
    running -= row.recpam;
  }

  // Subtotal: Resultado antes de Ganancias (from 0)
  bars.push({ name: "Res. antes Gan.", base: 0, value: running, total: true, color: running >= 0 ? "#22c55e" : "#ef4444" });

  bars.push({ name: "Imp. Ganancias", base: running - row.ganancias, value: row.ganancias, color: "#ef4444" });
  running -= row.ganancias;

  // Final: Resultado Neto (from 0)
  bars.push({ name: "Resultado Neto", base: 0, value: running, total: true, color: running >= 0 ? "#22c55e" : "#ef4444" });

  return bars;
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

  // Sueldos + Cargas Sociales (subtract)
  const sueldosCS = row.sueldos + row.cargasSociales;
  bars.push({
    name: "Sueldos + CS",
    base: running - sueldosCS,
    value: sueldosCS,
    color: "#6366f1",
  });
  running -= sueldosCS;

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
  const [ipcMap, setIpcMap] = useState<Map<string, number>>(new Map());
  const [taxMap, setTaxMap] = useState<Map<string, ResumenMensualRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedYear, setSelectedYear] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchResultado(), fetchIpcMensualMap(), fetchResumenFiscal()])
      .then(([rows, ipc, fiscal]) => {
        setRaw(rows);
        setIpcMap(ipc);
        setTaxMap(new Map(fiscal.mensual.map((r) => [r.periodo, r])));
      })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Latest IPC value available, or the hardcoded fallback — used when a period has no IPC data
  const ipcFallback = useMemo(() => computeIpcFallback(ipcMap), [ipcMap]);

  // Adjust for inflation + compute RECPAM, Amortizaciones, EBITDA
  const data: ExtendedResultadoRow[] = useMemo(
    () => raw.map((r) => {
        const year = r.periodo.split("-")[0];
        const ing = adjust(r.ingresos, r.periodo);
        const costOp = adjust(r.costosOperativos, r.periodo);
        const sueldos = adjust(r.sueldos, r.periodo);
        const cargasSoc = adjust(r.cargasSociales, r.periodo);
        // Costos Comerciales: 4.5% IIBB + 1% Seg. e Hig. + cuotas fijas municipales
        // Uses r.ingresos (same base shown in the P&L) for consistency across views
        const costComNominal = computeGastosComerciales(r.ingresos, r.periodo);
        const costCom = adjust(costComNominal, r.periodo);
        // Costos Financieros: bank fees/interest + Imp. al Cheque from Resumen Fiscal
        const tax = taxMap.get(r.periodo);
        const costFin = adjust(r.costosFinancieros + (tax?.cheque ?? 0), r.periodo);
        const margenBruto = ing - costOp - sueldos - cargasSoc;

        // RECPAM: datos auditados para años históricos; estimado para el resto.
        // Estimación: RECPAM = ingresos × RATIO_PMN × inflación_mensual
        // donde RATIO_PMN ≈ 2.18 (posición monetaria neta / ingresos, derivado de 0.218 / 0.10)
        // Fallback: última inflación conocida (ipcFallback), no ratio fijo.
        let recpamNominal: number;
        let recpamEstimado: boolean;
        let recpamConIpcReal: boolean;
        if (year in RECPAM_HISTORICO) {
          recpamNominal = RECPAM_HISTORICO[year] / 12;
          recpamEstimado = false;
          recpamConIpcReal = false;
        } else {
          const inflacionDecimal = ipcMap.get(r.periodo) ?? null;
          if (inflacionDecimal !== null) {
            recpamNominal = r.ingresos * RATIO_PMN * inflacionDecimal;
            recpamConIpcReal = true;
          } else {
            // Usar última inflación conocida en lugar del ratio fijo 21.8%
            // (que estaba calibrado para ~10 % mensual de 2024 y sobrestima 7x con inflación del 3 %)
            recpamNominal = r.ingresos * RATIO_PMN * ipcFallback;
            recpamConIpcReal = false;
          }
          recpamEstimado = true;
        }
        // For historical RECPAM (2024 and earlier), the value is at Dec prices
        // of that year, so use "YYYY-12" as base month for inflation adjustment.
        const recpamBase = (year in RECPAM_HISTORICO) ? `${year}-12` : r.periodo;
        const recpam = adjust(recpamNominal, recpamBase);

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
          cargasSociales: cargasSoc,
          margenBruto,
          costosComercialesAdmin: costCom,
          costosFinancieros: costFin,
          recpam,
          recpamEstimado,
          recpamConIpcReal,
          amortizaciones,
          ebitda,
          resultadoAntesGanancias: resAntesGan,
          ganancias: gan,
          resultadoNeto: resNeto,
          margenPct,
        };
      }),
    [raw, adjust, ipcMap, ipcFallback, taxMap],
  );

  // Available years from data
  const availableYears = useMemo(() => {
    const years = Array.from(new Set(data.map((r) => r.periodo.split("-")[0]))).sort();
    return years;
  }, [data]);

  // Default to current year (or last available)
  const activeYear = selectedYear ?? availableYears[availableYears.length - 1] ?? new Date().getFullYear().toString();

  // YTD: find the last month with data in the most recent year
  const ytdLastMonth = useMemo(() => {
    if (data.length === 0) return 0;
    const lastYear = availableYears[availableYears.length - 1];
    if (!lastYear) return 0;
    let maxMonth = 0;
    for (const r of data) {
      if (r.periodo.startsWith(lastYear)) {
        const m = parseInt(r.periodo.split("-")[1], 10);
        if (m > maxMonth) maxMonth = m;
      }
    }
    return maxMonth;
  }, [data, availableYears]);

  // Aggregate by selected granularity, then filter by year
  const tablePeriods = useMemo(() => {
    const aggregated = aggregateResultado(data, granularity, ytdLastMonth);
    if (granularity === "anual" || granularity === "ytd") return aggregated;
    return aggregated.filter((r) => r.periodo.startsWith(activeYear));
  }, [data, granularity, activeYear, ytdLastMonth]);

  const lastRow = data.length > 0 ? data[data.length - 1] : null;

  // Monthly waterfall: selectable month
  const [waterfallMonth, setWaterfallMonth] = useState<string | null>(null);
  const activeWaterfallPeriodo = waterfallMonth ?? lastRow?.periodo ?? "";
  const waterfallRow = data.find((r) => r.periodo === activeWaterfallPeriodo) ?? null;
  const waterfall = waterfallRow ? buildWaterfall(waterfallRow) : [];

  // Annual waterfall: aggregate by year, select one year
  const [waterfallYear, setWaterfallYear] = useState<string | null>(null);
  const annualAggregated = useMemo(() => aggregateResultado(data, "anual"), [data]);
  const activeWaterfallYear = waterfallYear ?? availableYears[availableYears.length - 1] ?? "";
  const annualWaterfall = useMemo(() => {
    const row = annualAggregated.find((r) => r.periodo === activeWaterfallYear);
    return row ? buildAnnualWaterfall(row) : [];
  }, [annualAggregated, activeWaterfallYear]);

  // Margin evolution — same year filter for mensual/trimestral, last 12 for anual/ytd
  const marginData = useMemo(() => {
    const source = (granularity === "anual" || granularity === "ytd") ? data.slice(-12) : data.filter((r) => r.periodo.startsWith(activeYear));
    return source.map((r) => ({
      label: shortLabel(r.periodo),
      margen: r.margenPct,
    }));
  }, [data, granularity, activeYear]);

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
          <div className="flex items-center gap-2">
            {granularity !== "anual" && granularity !== "ytd" && (
              <div className="flex items-center rounded-lg border text-xs font-medium">
                {availableYears.map((y) => (
                  <button
                    key={y}
                    onClick={() => setSelectedYear(y)}
                    className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                      activeYear === y
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center rounded-lg border text-xs font-medium">
              {(["mensual", "trimestral", "anual", "ytd"] as Granularity[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                    granularity === g
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {g === "ytd" ? "YTD" : g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px]">Concepto</TableHead>
                {tablePeriods.map((r) => (
                  <TableHead key={r.periodo} className="text-right">
                    {granularityLabel(r.periodo, granularity, ytdLastMonth)}
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
                label="Sueldos y Cargas Sociales"
                values={tablePeriods.map((r) => r.sueldos + r.cargasSociales)}
                indent
                negative
              />
              <TableRow className="text-xs text-muted-foreground">
                <TableCell className="pl-12">Sueldos</TableCell>
                {tablePeriods.map((r) => (
                  <TableCell key={r.periodo} className="text-right">{formatARS(r.sueldos)}</TableCell>
                ))}
              </TableRow>
              <TableRow className="text-xs text-muted-foreground">
                <TableCell className="pl-12">Cargas Sociales (F.931)</TableCell>
                {tablePeriods.map((r) => (
                  <TableCell key={r.periodo} className="text-right">{formatARS(r.cargasSociales)}</TableCell>
                ))}
              </TableRow>
              <PnlLine
                label="Margen Bruto"
                values={tablePeriods.map((r) => r.margenBruto)}
                bold
                border
              />
              <TableRow>
                <TableCell className="text-xs italic text-muted-foreground pl-8">Margen bruto %</TableCell>
                {tablePeriods.map((r) => {
                  const pct = r.ingresos > 0 ? (r.margenBruto / r.ingresos) * 100 : 0;
                  return (
                    <TableCell key={r.periodo} className={`text-right text-xs italic ${pct >= 0 ? "text-blue-600" : "text-red-600"}`}>
                      {pct.toFixed(1)}%
                    </TableCell>
                  );
                })}
              </TableRow>
              <PnlLine
                label="EBITDA"
                values={tablePeriods.map((r) => r.ebitda)}
                bold
                infoTip={`EBITDA = Margen Bruto + Amortizaciones (~${formatARS(AMORT_MENSUAL_BASE)}/mes base 2024). Datos de estados contables auditados para 2021-2024.`}
              />
              <TableRow>
                <TableCell className="text-xs italic text-muted-foreground pl-8">EBITDA %</TableCell>
                {tablePeriods.map((r) => {
                  const pct = r.ingresos > 0 ? (r.ebitda / r.ingresos) * 100 : 0;
                  return (
                    <TableCell key={r.periodo} className={`text-right text-xs italic ${pct >= 0 ? "text-blue-600" : "text-red-600"}`}>
                      {pct.toFixed(1)}%
                    </TableCell>
                  );
                })}
              </TableRow>
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
                infoTip="Resultado por exposición al cambio en el poder adquisitivo de la moneda. Datos auditados 2021-2024. Para períodos posteriores: ingresos × PMN (2.18) × inflación mensual IPC real; fallback al ratio fijo 21.8% si no hay dato IPC cargado."
                annotations={tablePeriods.map((r) => {
                  if (!r.recpamEstimado) return null;
                  return r.recpamConIpcReal
                    ? "Estimado con inflación IPC real (ingresos × 2.18 × IPC mensual)"
                    : `Estimado con última inflación conocida (ingresos × 2.18 × ${(ipcFallback * 100).toFixed(1)}%)`;
                })}
              />
              <PnlLine
                label="Resultado antes de Ganancias"
                values={tablePeriods.map((r) => r.resultadoAntesGanancias)}
                bold
                border
              />
              <TableRow>
                <TableCell className="text-xs italic text-muted-foreground pl-8">Resultado antes de Gan. %</TableCell>
                {tablePeriods.map((r) => {
                  const pct = r.ingresos > 0 ? (r.resultadoAntesGanancias / r.ingresos) * 100 : 0;
                  return (
                    <TableCell key={r.periodo} className={`text-right text-xs italic ${pct >= 0 ? "text-blue-600" : "text-red-600"}`}>
                      {pct.toFixed(1)}%
                    </TableCell>
                  );
                })}
              </TableRow>
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
              <TableRow>
                <TableCell className="text-xs italic text-muted-foreground pl-8">Margen neto %</TableCell>
                {tablePeriods.map((r) => (
                  <TableCell
                    key={r.periodo}
                    className={`text-right text-xs italic ${
                      r.margenPct >= 0 ? "text-blue-600" : "text-red-600"
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
                  label: granularityLabel(r.periodo, granularity, ytdLastMonth),
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
              {granularity === "mensual" ? "Resultado Neto Mensual" : granularity === "trimestral" ? "Resultado Neto Trimestral" : granularity === "ytd" ? "Resultado Neto YTD" : "Resultado Neto Anual"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={tablePeriods.map((r) => ({
                  label: granularityLabel(r.periodo, granularity, ytdLastMonth),
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
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Cascada — {waterfallRow ? periodoLabel(waterfallRow.periodo) : ""}
            </CardTitle>
            <select
              value={activeWaterfallPeriodo}
              onChange={(e) => setWaterfallMonth(e.target.value)}
              className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm font-medium cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {[...data].reverse().map((r) => (
                <option key={r.periodo} value={r.periodo}>
                  {periodoLabel(r.periodo)}
                </option>
              ))}
            </select>
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

      {/* Annual Waterfall */}
      {annualWaterfall.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Cascada Anual — {activeWaterfallYear}</CardTitle>
            <div className="flex items-center rounded-lg border text-xs font-medium">
              {availableYears.map((y) => (
                <button
                  key={y}
                  onClick={() => setWaterfallYear(y)}
                  className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                    activeWaterfallYear === y
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={annualWaterfall} margin={{ top: 30, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" fontSize={11} interval={0} angle={-25} textAnchor="end" height={60} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
                <Tooltip formatter={arsTooltip} />
                <ReferenceLine y={0} stroke="#666" />
                {/* Invisible base */}
                <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
                {/* Visible value with labels */}
                <Bar dataKey="value" stackId="w" radius={[4, 4, 0, 0]} label={<WaterfallLabel data={annualWaterfall} />}>
                  {annualWaterfall.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Cost Structure (% of Revenue) */}
      <CostStructureTable data={data} availableYears={availableYears} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost Structure (% of Revenue)
// ---------------------------------------------------------------------------
type CostGranularity = "mensual" | "trimestral" | "anual";

const COST_GRAN_LABELS: Record<CostGranularity, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  anual: "Anual",
};

function CostStructureTable({ data, availableYears }: { data: ExtendedResultadoRow[]; availableYears: string[] }) {
  const [gran, setGran] = useState<CostGranularity>("anual");
  const [yearFilter, setYearFilter] = useState<string | null>(null);

  const activeFilterYear = yearFilter ?? availableYears[availableYears.length - 1] ?? "";

  const columns = useMemo(() => {
    const aggregated = aggregateResultado(data, gran === "mensual" ? "mensual" : gran === "trimestral" ? "trimestral" : "anual");
    if (gran === "mensual") {
      return aggregated.filter((r) => r.periodo.startsWith(activeFilterYear));
    }
    if (gran === "trimestral") {
      return aggregated.filter((r) => r.periodo.startsWith(activeFilterYear));
    }
    return aggregated; // anual: show all years
  }, [data, gran, activeFilterYear]);

  if (columns.length === 0) return null;

  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  const lines: { label: string; getValue: (r: ExtendedResultadoRow) => number; bold: boolean; isResult: boolean }[] = [
    { label: "Ingresos Netos", getValue: (r) => r.ingresos, bold: false, isResult: false },
    { label: "C. Operativos", getValue: (r) => -r.costosOperativos, bold: false, isResult: false },
    { label: "Sueldos y CS", getValue: (r) => -(r.sueldos + r.cargasSociales), bold: false, isResult: false },
    { label: "Margen Bruto", getValue: (r) => r.margenBruto, bold: true, isResult: false },
    { label: "C. Comerciales", getValue: (r) => -r.costosComercialesAdmin, bold: false, isResult: false },
    { label: "C. Financieros", getValue: (r) => -r.costosFinancieros, bold: false, isResult: false },
    { label: "RECPAM", getValue: (r) => -r.recpam, bold: false, isResult: false },
    { label: "Res. antes Gan.", getValue: (r) => r.resultadoAntesGanancias, bold: true, isResult: false },
    { label: "Imp. Ganancias", getValue: (r) => -r.ganancias, bold: false, isResult: false },
    { label: "Resultado Neto", getValue: (r) => r.resultadoNeto, bold: true, isResult: true },
  ];

  const colLabel = (r: ExtendedResultadoRow) => {
    if (gran === "anual") return r.periodo;
    if (gran === "trimestral") {
      const [y, q] = r.periodo.split("-");
      return `${q} ${y}`;
    }
    return periodoLabel(r.periodo);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Estructura de Costos (% sobre Ingresos)</CardTitle>
        <div className="flex items-center gap-3">
          {gran === "mensual" && (
            <div className="flex items-center rounded-lg border text-xs font-medium">
              {availableYears.map((y) => (
                <button
                  key={y}
                  onClick={() => setYearFilter(y)}
                  className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                    activeFilterYear === y
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
          {gran === "trimestral" && (
            <div className="flex items-center rounded-lg border text-xs font-medium">
              {availableYears.map((y) => (
                <button
                  key={y}
                  onClick={() => setYearFilter(y)}
                  className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                    activeFilterYear === y
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center rounded-lg border text-xs font-medium">
            {(["mensual", "trimestral", "anual"] as CostGranularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGran(g)}
                className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  gran === g
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                }`}
              >
                {COST_GRAN_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Concepto</TableHead>
                {columns.map((c) => (
                  <TableHead key={c.periodo} className="text-right">{colLabel(c)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.label}>
                  <TableCell className={line.bold ? "font-bold" : ""}>{line.label}</TableCell>
                  {columns.map((c) => {
                    const pct = c.ingresos > 0 ? (line.getValue(c) / c.ingresos) * 100 : 0;
                    let colorClass = "";
                    if (line.isResult) {
                      colorClass = pct >= 0 ? "text-green-600" : "text-red-600";
                    }
                    return (
                      <TableCell
                        key={c.periodo}
                        className={`text-right ${line.bold ? "font-bold" : ""} ${colorClass}`}
                      >
                        {line.label === "Ingresos Netos"
                          ? "100%"
                          : fmtPct(pct)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Custom label for waterfall bars — shows formatted ARS value above each bar
// ---------------------------------------------------------------------------
function WaterfallLabel({ data, x, y, width, index }: {
  data: WaterfallBar[];
  x?: number;
  y?: number;
  width?: number;
  index?: number;
}) {
  if (x == null || y == null || width == null || index == null) return null;
  const entry = data[index];
  if (!entry) return null;
  // For subtotals/totals show the actual value; for deductions show the deducted amount
  const displayValue = entry.total ? entry.value : entry.value;
  const label = formatARS(displayValue);
  return (
    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10} fill="currentColor" className="fill-foreground">
      {label}
    </text>
  );
}

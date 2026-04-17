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
import { Loader2, AlertCircle, Info, ChevronDown } from "lucide-react";

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
import { fetchResumenFiscal, getCuotaFija, type ResumenMensualRow } from "@/lib/tax-queries";
import { fetchIpcMensualMap } from "@/lib/macro-queries";
import {
  fetchFechaCorteYtd,
  fetchIngresosMesParcial,
  fetchEgresosMesParcial,
  ytdMonthRangeLabel,
  type YtdCutoff,
  type IngresoParcial,
  type EgresoParcial,
} from "@/lib/ytd-cutoff";
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

function aggregateResultado(
  data: ExtendedResultadoRow[],
  granularity: Granularity,
  ytdLastMonth?: number,
  ytdPartialRows?: Map<string, ExtendedResultadoRow>,
): ExtendedResultadoRow[] {
  if (granularity === "mensual") return data;

  // For YTD: filter to months 1..ytdLastMonth. If a partial-month map is
  // provided (because the cutoff is not end-of-month), substitute rows for
  // that month across every year so the across-year comparison is truncated
  // to the same day.
  let source = data;
  if (granularity === "ytd" && ytdLastMonth) {
    const cutoffMonthStr = String(ytdLastMonth).padStart(2, "0");
    source = data
      .filter((r) => {
        const m = parseInt(r.periodo.split("-")[1], 10);
        return m >= 1 && m <= ytdLastMonth;
      })
      .map((r) => {
        if (!ytdPartialRows || ytdPartialRows.size === 0) return r;
        const m = r.periodo.split("-")[1];
        if (m !== cutoffMonthStr) return r;
        return ytdPartialRows.get(r.periodo) ?? r;
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
      cur.comercialesProveedor += r.comercialesProveedor;
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

function granularityLabel(
  p: string,
  g: Granularity,
  ytdLastMonth?: number,
  cutoff?: YtdCutoff | null,
): string {
  if (g === "anual") return p;
  if (g === "ytd" && ytdLastMonth) {
    const firstMonth = "01";
    const lastMonth = String(ytdLastMonth).padStart(2, "0");
    const range = ytdMonthRangeLabel(firstMonth, lastMonth, cutoff);
    return `${range} ${p}`;
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
      <TableCell className={`sticky left-0 z-10 bg-card ${bold ? "font-bold" : ""} ${indent ? "pl-8" : ""}`}>
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
// P&L row derivation — single source of truth for full-month and partial-month
// ---------------------------------------------------------------------------
// Given nominal values for the daily-truncatable items (ingresos, proveedores,
// sueldos, cargas, financieros bancarios) and a monthFraction (1 for full
// month, day/daysInMonth for partial), produces a fully-derived P&L row.
// monthFraction is applied inside the function to items without a partial RPC
// that don't scale with ingresos: cuotas fijas municipales, imp. al cheque,
// amortizaciones, RECPAM histórico.
// ---------------------------------------------------------------------------
interface DerivePnlInput {
  periodo: string;
  ingresosNominal: number;
  costosOperativosNominal: number;
  /** Honorarios+Seguros+Telefonía+Servicios públicos (van a Gastos Comerciales). */
  comercialesProveedorNominal: number;
  sueldosNominal: number;
  cargasSocialesNominal: number;
  costosFinancierosBankNominal: number;
  /** 1 for full month; (day/daysInMonth) for partial. */
  monthFraction: number;
}

interface DerivePnlCtx {
  adjust: (v: number, p: string) => number;
  ipcMap: Map<string, number>;
  ipcFallback: number;
  taxMap: Map<string, ResumenMensualRow>;
}

function derivePnlRow(input: DerivePnlInput, ctx: DerivePnlCtx): ExtendedResultadoRow {
  const { periodo, monthFraction: f } = input;
  const year = periodo.split("-")[0];
  const { adjust, ipcMap, ipcFallback, taxMap } = ctx;

  const ing = adjust(input.ingresosNominal, periodo);
  const costOp = adjust(input.costosOperativosNominal, periodo);
  const sueldos = adjust(input.sueldosNominal, periodo);
  const cargasSoc = adjust(input.cargasSocialesNominal, periodo);

  // Costos Comerciales: IIBB (4.5%) + Seg. e Hig. (1%) escalan con ingresos;
  // cuotas fijas municipales pro-rateadas + Imp. al Cheque (LEY 25.413)
  // pro-rateado por monthFraction + facturas de Honorarios/Seguros/Telefonía/
  // Servicios públicos (proveedor-based), idéntico criterio que
  // /economico/egresos/gastos-comerciales.
  const tax = taxMap.get(periodo);
  const costComNominal =
    input.ingresosNominal * 0.045 +
    input.ingresosNominal * 0.01 +
    (getCuotaFija("publicidad", periodo) + getCuotaFija("espacioPublico", periodo)) * f +
    (tax?.cheque ?? 0) * f +
    input.comercialesProveedorNominal;
  const costCom = adjust(costComNominal, periodo);

  // Costos Financieros: sólo bancarios (comisiones, intereses, seguros).
  const costFin = adjust(input.costosFinancierosBankNominal, periodo);

  const margenBruto = ing - costOp - sueldos - cargasSoc;

  // RECPAM: histórico auditado pro-rateado por f; estimado con inflación IPC
  // (o fallback), que escala naturalmente con ingresosNominal.
  let recpamNominal: number;
  let recpamEstimado: boolean;
  let recpamConIpcReal: boolean;
  if (year in RECPAM_HISTORICO) {
    recpamNominal = (RECPAM_HISTORICO[year] / 12) * f;
    recpamEstimado = false;
    recpamConIpcReal = false;
  } else {
    const inflacionDecimal = ipcMap.get(periodo) ?? null;
    if (inflacionDecimal !== null) {
      recpamNominal = input.ingresosNominal * RATIO_PMN * inflacionDecimal;
      recpamConIpcReal = true;
    } else {
      recpamNominal = input.ingresosNominal * RATIO_PMN * ipcFallback;
      recpamConIpcReal = false;
    }
    recpamEstimado = true;
  }
  const recpamBase = year in RECPAM_HISTORICO ? `${year}-12` : periodo;
  const recpam = adjust(recpamNominal, recpamBase);

  // Amortizaciones: base mensual (anual/12) pro-rateada por f.
  const amortBase = year in AMORTIZACIONES_ANUAL
    ? AMORTIZACIONES_ANUAL[year] / 12
    : AMORT_MENSUAL_BASE;
  const amortizaciones = adjust(amortBase * f, periodo);

  const ebitda = margenBruto + amortizaciones;
  const resAntesGan = margenBruto - costCom - costFin - recpam;
  const gan = resAntesGan > 0 ? resAntesGan * TASA_GANANCIAS : 0;
  const resNeto = resAntesGan - gan;
  const margenPct = ing > 0 ? (resNeto / ing) * 100 : 0;

  return {
    periodo,
    ingresos: ing,
    costosOperativos: costOp,
    comercialesProveedor: adjust(input.comercialesProveedorNominal, periodo),
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
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function EstadoResultadosPage() {
  const { adjust } = useInflation();
  const [raw, setRaw] = useState<ResultadoRow[]>([]);
  const [ipcMap, setIpcMap] = useState<Map<string, number>>(new Map());
  const [taxMap, setTaxMap] = useState<Map<string, ResumenMensualRow>>(new Map());
  const [ytdCutoff, setYtdCutoff] = useState<YtdCutoff | null>(null);
  const [partialIng, setPartialIng] = useState<Map<string, IngresoParcial>>(new Map());
  const [partialEgr, setPartialEgr] = useState<Map<string, EgresoParcial>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [isPnlCollapsed, setIsPnlCollapsed] = useState(false);
  const [isInfoCollapsed, setIsInfoCollapsed] = useState(false);

  useEffect(() => {
    Promise.all([fetchResultado(), fetchIpcMensualMap(), fetchResumenFiscal()])
      .then(([rows, ipc, fiscal]) => {
        setRaw(rows);
        setIpcMap(ipc);
        setTaxMap(new Map(fiscal.mensual.map((r) => [r.periodo, r])));
      })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));

    // YTD cutoff from DB (last date with data). If it's not end-of-month,
    // fetch partial-month data for that (month, day) to truncate all years
    // to the same day in the YTD comparison.
    fetchFechaCorteYtd()
      .then((c) => {
        if (!c) return;
        setYtdCutoff(c);
        if (!c.esFindeMes) {
          fetchIngresosMesParcial(c.mes, c.dia).then(setPartialIng).catch(() => {});
          fetchEgresosMesParcial(c.mes, c.dia).then(setPartialEgr).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Latest IPC value available, or the hardcoded fallback — used when a period has no IPC data
  const ipcFallback = useMemo(() => computeIpcFallback(ipcMap), [ipcMap]);

  // Full-month derivation: delegates to derivePnlRow with monthFraction=1.
  const data: ExtendedResultadoRow[] = useMemo(() => {
    const ctx: DerivePnlCtx = { adjust, ipcMap, ipcFallback, taxMap };
    return raw.map((r) => derivePnlRow({
      periodo: r.periodo,
      ingresosNominal: r.ingresos,
      costosOperativosNominal: r.costosOperativos,
      comercialesProveedorNominal: r.comercialesProveedor,
      sueldosNominal: r.sueldos,
      cargasSocialesNominal: r.cargasSociales,
      costosFinancierosBankNominal: r.costosFinancieros,
      monthFraction: 1,
    }, ctx));
  }, [raw, adjust, ipcMap, ipcFallback, taxMap]);

  // Available years from data
  const availableYears = useMemo(() => {
    const years = Array.from(new Set(data.map((r) => r.periodo.split("-")[0]))).sort();
    return years;
  }, [data]);

  // Default to current year (or last available)
  const activeYear = selectedYear ?? availableYears[availableYears.length - 1] ?? new Date().getFullYear().toString();

  // YTD: last month with data in the most recent year
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

  // Per-year partial-month rows for YTD: built only when the cutoff is not
  // end-of-month AND partial data has loaded. Substitute every year's cutoff
  // month so comparisons are truncated to the same day.
  const ytdPartialRows = useMemo(() => {
    const m = new Map<string, ExtendedResultadoRow>();
    if (!ytdCutoff || ytdCutoff.esFindeMes) return m;
    if (partialIng.size === 0 && partialEgr.size === 0) return m;
    const cutoffMonthStr = String(ytdCutoff.mes).padStart(2, "0");
    const ctx: DerivePnlCtx = { adjust, ipcMap, ipcFallback, taxMap };
    for (const r of raw) {
      const [y, mm] = r.periodo.split("-");
      if (mm !== cutoffMonthStr) continue;
      const daysInMonth = new Date(parseInt(y, 10), ytdCutoff.mes, 0).getDate();
      const ratio = Math.min(1, ytdCutoff.dia / daysInMonth);
      const ingP = partialIng.get(r.periodo);
      const egrP = partialEgr.get(r.periodo);
      m.set(r.periodo, derivePnlRow({
        periodo: r.periodo,
        // Day-truncatable items: use partial RPC when available, else pro-rate nominal.
        ingresosNominal: ingP
          ? ingP.mostrador + ingP.restobar + ingP.servicios
          : r.ingresos * ratio,
        // egrP.proveedores es el total (operativo+comercial); le restamos la
        // porción comercial pro-rateada, asumiendo que su distribución diaria
        // es uniforme (honorarios/seguros/telefonía suelen ser mensuales).
        costosOperativosNominal:
          (egrP?.proveedores ?? (r.costosOperativos + r.comercialesProveedor) * ratio)
          - r.comercialesProveedor * ratio,
        comercialesProveedorNominal: r.comercialesProveedor * ratio,
        costosFinancierosBankNominal: egrP?.financieros ?? r.costosFinancieros * ratio,
        // Monthly-only concepts (F.931): pro-rate by day.
        sueldosNominal: r.sueldos * ratio,
        cargasSocialesNominal: r.cargasSociales * ratio,
        monthFraction: ratio,
      }, ctx));
    }
    return m;
  }, [raw, ytdCutoff, adjust, ipcMap, ipcFallback, taxMap, partialIng, partialEgr]);

  // Aggregate by selected granularity, then filter by year
  const tablePeriods = useMemo(() => {
    const aggregated = aggregateResultado(data, granularity, ytdLastMonth, ytdPartialRows);
    if (granularity === "anual" || granularity === "ytd") return aggregated;
    return aggregated.filter((r) => r.periodo.startsWith(activeYear));
  }, [data, granularity, activeYear, ytdLastMonth, ytdPartialRows]);

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

      {/* Info callout */}
      <Card className="border-l-4 border-l-primary">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4 shrink-0 text-primary" />
            <CardTitle className="text-sm font-semibold">Cómo leer este Estado de Resultados</CardTitle>
          </div>
          <button
            onClick={() => setIsInfoCollapsed((v) => !v)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label={isInfoCollapsed ? "Expandir explicación" : "Colapsar explicación"}
            aria-expanded={!isInfoCollapsed}
          >
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                isInfoCollapsed ? "-rotate-90" : ""
              }`}
            />
          </button>
        </CardHeader>
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            isInfoCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="overflow-hidden">
            <CardContent className="pt-0 text-sm space-y-2">
              <p>
                P&L armado desde los <strong>datos operativos</strong> (ventas POS, facturas ARCA, F.931, movimientos bancarios, impuestos) — no es una copia del balance del contador, es lo que se deduce de la operatoria del mes.
              </p>
              <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Criterio devengado</strong>: sueldos salen del F.931 del mes (no de cuándo se pagan); IIBB, Seg. e Higiene y cargas sociales se calculan sobre la base del mes.
                </li>
                <li>
                  <strong className="text-foreground">Ajuste por inflación</strong>: los montos se guardan en pesos nominales. Con el toggle arriba a la derecha se ajustan al mes más reciente vía IPC. Sin ajuste, comparar años distintos engaña.
                </li>
                <li>
                  <strong className="text-foreground">Partes estimadas</strong>: RECPAM y amortizaciones son reales para 2021-2024 (EECC auditados); para 2025+ se estiman (<em>RECPAM = ingresos × PMN × IPC</em>; amortizaciones con base 2024/12). Imp. a las Ganancias es una estimación al 36,7% efectivo — no contempla diferencias temporarias ni ajuste impositivo.
                </li>
                <li>
                  <strong className="text-foreground">Modo YTD</strong>: cuando el último mes no está completo, todos los años de la comparación se truncan al mismo día (p. ej. &ldquo;Ene–7 Abr&rdquo;) para que la comparación año contra año sea justa.
                </li>
              </ul>
            </CardContent>
          </div>
        </div>
      </Card>

      {/* P&L Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsPnlCollapsed((v) => !v)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              aria-label={isPnlCollapsed ? "Expandir tabla" : "Colapsar tabla"}
              aria-expanded={!isPnlCollapsed}
            >
              <ChevronDown
                className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
                  isPnlCollapsed ? "-rotate-90" : ""
                }`}
              />
            </button>
            <CardTitle className="text-base">Estado de Resultados</CardTitle>
          </div>
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
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            isPnlCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="overflow-hidden">
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[220px] sticky left-0 z-20 bg-card">Concepto</TableHead>
                {tablePeriods.map((r) => (
                  <TableHead key={r.periodo} className="text-right">
                    {granularityLabel(r.periodo, granularity, ytdLastMonth, ytdCutoff)}
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
                <TableCell className="sticky left-0 z-10 bg-card pl-12">Sueldos</TableCell>
                {tablePeriods.map((r) => (
                  <TableCell key={r.periodo} className="text-right">{formatARS(r.sueldos)}</TableCell>
                ))}
              </TableRow>
              <TableRow className="text-xs text-muted-foreground">
                <TableCell className="sticky left-0 z-10 bg-card pl-12">Cargas Sociales (F.931)</TableCell>
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
                <TableCell className="sticky left-0 z-10 bg-card text-xs italic text-muted-foreground pl-8">Margen bruto %</TableCell>
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
                <TableCell className="sticky left-0 z-10 bg-card text-xs italic text-muted-foreground pl-8">EBITDA %</TableCell>
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
                <TableCell className="sticky left-0 z-10 bg-card text-xs italic text-muted-foreground pl-8">Resultado antes de Gan. %</TableCell>
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
                <TableCell className="sticky left-0 z-10 bg-card text-xs italic text-muted-foreground pl-8">Margen neto %</TableCell>
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
          </div>
        </div>
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
                  label: granularityLabel(r.periodo, granularity, ytdLastMonth, ytdCutoff),
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
                  label: granularityLabel(r.periodo, granularity, ytdLastMonth, ytdCutoff),
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

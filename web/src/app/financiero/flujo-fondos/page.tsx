"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart, Bar, AreaChart, Area, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Loader2, AlertCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type FlujoDeFondosRow,
  fetchFlujoDeFondos,
  formatARS, formatPct, pctDelta, periodoLabel, shortLabel,
} from "@/lib/financial-queries";
import { DetallePorCategoria } from "./detalle-categoria";
import type { Formatter, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));
const SHORT_MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// ─── Color palette (charts + category cards only) ───────────────────────────
const COLORS = {
  cobros: "#22c55e", pagos: "#ef4444",
  efectivo: "#f59e0b", banco: "#3b82f6", provincia: "#3b82f6", santander: "#ef4444", mp: "#8b5cf6",
  proveedores: "#ef4444", sueldos: "#f97316", impuestos: "#06b6d4",
  financieros: "#64748b", tarjetas: "#f59e0b",
  retirosSocios: "#d946ef", transferencias: "#8b5cf6", financiamiento: "#14b8a6", neto: "#3b82f6",
};

// ─── Types ──────────────────────────────────────────────────────────────────
type Granularity = "mensual" | "trimestral" | "anual";
type TableView = "detalle" | "ytd" | "anual";
type ChartRange = "year" | "12m" | "all";

const QUARTER_LABELS: Record<string, string> = {
  "01": "Q1", "02": "Q1", "03": "Q1", "04": "Q2", "05": "Q2", "06": "Q2",
  "07": "Q3", "08": "Q3", "09": "Q3", "10": "Q4", "11": "Q4", "12": "Q4",
};

interface AggRow {
  key: string; label: string;
  cobrosEfectivo: number; cobrosBancoProvincia: number; cobrosBancoSantander: number; cobrosMP: number;
  totalCobros: number; financiamientoRecibido: number;
  pagosProveedores: number; pagosSueldos: number; pagosImpuestos: number;
  pagosGastosFinancieros: number; pagosTarjetas: number; totalPagos: number;
  flujoNeto: number; retirosSocios: number; transferencias: number;
}

const AGG_ZERO: Omit<AggRow, "key" | "label"> = {
  cobrosEfectivo: 0, cobrosBancoProvincia: 0, cobrosBancoSantander: 0, cobrosMP: 0,
  totalCobros: 0, financiamientoRecibido: 0,
  pagosProveedores: 0, pagosSueldos: 0, pagosImpuestos: 0,
  pagosGastosFinancieros: 0, pagosTarjetas: 0, totalPagos: 0,
  flujoNeto: 0, retirosSocios: 0, transferencias: 0,
};

function addRow(a: Omit<AggRow, "key" | "label">, r: FlujoDeFondosRow) {
  a.cobrosEfectivo += r.cobrosEfectivo; a.cobrosBancoProvincia += r.cobrosBancoProvincia;
  a.cobrosBancoSantander += r.cobrosBancoSantander; a.cobrosMP += r.cobrosMP;
  a.totalCobros += r.totalCobros; a.financiamientoRecibido += r.financiamientoRecibido;
  a.pagosProveedores += r.pagosProveedores; a.pagosSueldos += r.pagosSueldos;
  a.pagosImpuestos += r.pagosImpuestos; a.pagosGastosFinancieros += r.pagosGastosFinancieros;
  a.pagosTarjetas += r.pagosTarjetas; a.totalPagos += r.totalPagos;
  a.flujoNeto += r.flujoNeto; a.retirosSocios += r.retirosSocios; a.transferencias += r.transferencias;
}

// ─── Aggregation ────────────────────────────────────────────────────────────

function aggregateDetail(data: FlujoDeFondosRow[], gran: Granularity): AggRow[] {
  if (gran === "mensual") return data.map((r) => ({ ...AGG_ZERO, ...r, key: r.periodo, label: periodoLabel(r.periodo) }));
  const b = new Map<string, AggRow>();
  for (const r of data) {
    const [y, m] = r.periodo.split("-");
    const k = gran === "trimestral" ? `${y}-${QUARTER_LABELS[m]}` : y;
    const c = b.get(k) ?? { ...AGG_ZERO, key: k, label: gran === "trimestral" ? `${QUARTER_LABELS[m]} ${y}` : y };
    addRow(c, r); b.set(k, c);
  }
  return Array.from(b.values()).sort((a, x) => a.key.localeCompare(x.key));
}

function aggregatePerYear(data: FlujoDeFondosRow[], maxMonth?: number): AggRow[] {
  const by = new Map<number, AggRow>();
  for (const r of data) {
    const [yS, mS] = r.periodo.split("-");
    const y = parseInt(yS, 10), m = parseInt(mS, 10);
    if (maxMonth !== undefined && m > maxMonth) continue;
    const c = by.get(y) ?? { ...AGG_ZERO, key: yS, label: maxMonth ? `${y} (YTD)` : String(y) };
    addRow(c, r); by.set(y, c);
  }
  return Array.from(by.values()).sort((a, x) => a.key.localeCompare(x.key));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getYtdData(data: FlujoDeFondosRow[], year: number, maxMonth: number) {
  return data.filter((r) => { const [y, m] = r.periodo.split("-"); return parseInt(y, 10) === year && parseInt(m, 10) <= maxMonth; });
}
function sumField(rows: FlujoDeFondosRow[], fn: (r: FlujoDeFondosRow) => number) { return rows.reduce((s, r) => s + fn(r), 0); }

// ─── KPI Card — black values, only flujoNeto colored ────────────────────────

function KpiCard({ title, value, delta, invertDelta, subtitle, netoColor }: {
  title: string; value: number; delta: number | null;
  invertDelta?: boolean; subtitle?: string; netoColor?: boolean;
}) {
  const good = delta !== null && (invertDelta ? delta < 0 : delta > 0);
  const bad = delta !== null && (invertDelta ? delta > 0 : delta < 0);
  const DeltaIcon = delta === null ? Minus : good ? TrendingUp : bad ? TrendingDown : Minus;
  const valueColor = netoColor ? (value >= 0 ? "text-green-600" : "text-red-600") : "";
  return (
    <div className="rounded-xl bg-muted/50 p-5 space-y-2">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className={`text-2xl font-bold tracking-tight ${valueColor}`}>{formatARS(value)}</p>
      <div className="flex items-center gap-1.5">
        {delta !== null ? (
          <>
            <DeltaIcon className={`h-3.5 w-3.5 ${good ? "text-green-600" : bad ? "text-red-600" : "text-muted-foreground"}`} />
            <span className={`text-xs font-medium ${good ? "text-green-600" : bad ? "text-red-600" : "text-muted-foreground"}`}>
              {formatPct(delta)} vs año anterior
            </span>
          </>
        ) : subtitle ? (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        ) : (
          <span className="text-xs text-muted-foreground">Sin datos previos</span>
        )}
      </div>
    </div>
  );
}

// ─── Table helpers ──────────────────────────────────────────────────────────

function Ars({ value, bold, neto }: { value: number; bold?: boolean; neto?: boolean }) {
  if (value === 0) return <span className="text-muted-foreground">—</span>;
  const c = neto ? (value >= 0 ? "text-green-600" : "text-red-600") : "";
  return <span className={`tabular-nums ${bold ? "font-semibold" : ""} ${c}`}>{formatARS(value)}</span>;
}

function DeltaCell({ value, favorable }: { value: number | null; favorable: "higher" | "lower" }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const g = favorable === "higher" ? value > 0 : value < 0;
  const b = favorable === "higher" ? value < 0 : value > 0;
  return <span className={`text-xs font-medium ${g ? "text-green-600" : b ? "text-red-600" : "text-muted-foreground"}`}>{formatPct(value)}</span>;
}

function Seg<T extends string>({ options, value, onChange, labels }: {
  options: T[]; value: T; onChange: (v: T) => void; labels?: Record<T, string>;
}) {
  return (
    <div className="flex items-center rounded-lg border text-xs font-medium">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${value === o ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
        >{labels?.[o] ?? o}</button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function FlujoDeFondosPage() {
  const { adjust, adjusted } = useInflation();
  const [raw, setRaw] = useState<FlujoDeFondosRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [tableView, setTableView] = useState<TableView>("detalle");
  const [selectedYear, setSelectedYear] = useState<number>(0);
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  // Chart-specific filters (independent of table)
  const [chartYear, setChartYear] = useState<number>(0);
  const [chartRange, setChartRange] = useState<ChartRange>("year");
  // Multi-year select for YTD/Anual comparison
  const [compYears, setCompYears] = useState<number[]>([]);

  useEffect(() => {
    fetchFlujoDeFondos()
      .then(setRaw)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // ─── Inflation-adjusted data ────────────────────────────────────────────
  const data = useMemo(() => {
    let acum = 0;
    return raw.map((r) => {
      const ce = adjust(r.cobrosEfectivo, r.periodo), cb = adjust(r.cobrosBanco, r.periodo);
      const cbp = adjust(r.cobrosBancoProvincia, r.periodo), cbs = adjust(r.cobrosBancoSantander, r.periodo);
      const cm = adjust(r.cobrosMP, r.periodo), tc = ce + cb + cm;
      const fr = adjust(r.financiamientoRecibido, r.periodo);
      const pp = adjust(r.pagosProveedores, r.periodo), su = adjust(r.pagosSueldos, r.periodo);
      const im = adjust(r.pagosImpuestos, r.periodo), gf = adjust(r.pagosGastosFinancieros, r.periodo);
      const pt = adjust(r.pagosTarjetas, r.periodo), tp = pp + su + im + gf + pt;
      const pProv = adjust(r.pagosProvincia, r.periodo), pSant = adjust(r.pagosSantander, r.periodo);
      const rs = adjust(r.retirosSocios, r.periodo), tr = adjust(r.transferencias, r.periodo);
      const fn = tc - tp; acum += fn;
      return { periodo: r.periodo, cobrosEfectivo: ce, cobrosBanco: cb, cobrosBancoProvincia: cbp, cobrosBancoSantander: cbs,
        cobrosMP: cm, totalCobros: tc, financiamientoRecibido: fr,
        pagosProveedores: pp, pagosSueldos: su, pagosImpuestos: im, pagosGastosFinancieros: gf, pagosTarjetas: pt,
        totalPagos: tp, pagosProvincia: pProv, pagosSantander: pSant,
        flujoNeto: fn, acumulado: acum, retirosSocios: rs, transferencias: tr };
    });
  }, [raw, adjust]);

  // ─── Derived ────────────────────────────────────────────────────────────
  const availableYears = useMemo(() => Array.from(new Set(data.map((r) => parseInt(r.periodo.slice(0, 4))))).sort((a, b) => b - a), [data]);
  const currentYear = availableYears[0] ?? new Date().getFullYear();
  const activeYear = selectedYear || currentYear;
  const prevYear = activeYear - 1;
  const activeChartYear = chartYear || currentYear;

  const lastPeriodo = useMemo(() => {
    const yr = data.filter((r) => r.periodo.startsWith(`${activeYear}-`));
    return yr.length > 0 ? yr[yr.length - 1].periodo : `${activeYear}-12`;
  }, [data, activeYear]);
  const lastMonth = parseInt(lastPeriodo.split("-")[1], 10);
  const lastDay = new Date().getDate();

  const availableMonths = useMemo(() => data.map((r) => r.periodo).sort(), [data]);
  const activeMonth = selectedMonth || (availableMonths.length > 0 ? availableMonths[availableMonths.length - 1] : "");

  const ytdCurrent = useMemo(() => getYtdData(data, activeYear, lastMonth), [data, activeYear, lastMonth]);
  const ytdPrev = useMemo(() => getYtdData(data, prevYear, lastMonth), [data, prevYear, lastMonth]);

  // Init compYears when availableYears change
  useEffect(() => { if (compYears.length === 0 && availableYears.length > 0) setCompYears(availableYears.slice(0, 3)); }, [availableYears, compYears.length]);

  // ─── YTD KPIs ──────────────────────────────────────────────────────────
  const cobrosYtd = sumField(ytdCurrent, (r) => r.totalCobros);
  const cobrosPrevYtd = sumField(ytdPrev, (r) => r.totalCobros);
  const pagosYtd = sumField(ytdCurrent, (r) => r.totalPagos);
  const pagosPrevYtd = sumField(ytdPrev, (r) => r.totalPagos);
  const flujoNetoYtd = cobrosYtd - pagosYtd;
  const flujoNetoPrevYtd = cobrosPrevYtd - pagosPrevYtd;
  const financYtd = sumField(ytdCurrent, (r) => r.financiamientoRecibido);
  const financPrevYtd = sumField(ytdPrev, (r) => r.financiamientoRecibido);
  const financMonths = ytdCurrent.filter((r) => r.financiamientoRecibido > 0).length;

  // ─── Monthly KPIs ──────────────────────────────────────────────────────
  const monthRow = useMemo(() => data.find((r) => r.periodo === activeMonth), [data, activeMonth]);
  const prevYearMonth = useMemo(() => {
    if (!activeMonth) return null;
    const [y, m] = activeMonth.split("-");
    return data.find((r) => r.periodo === `${parseInt(y, 10) - 1}-${m}`) ?? null;
  }, [data, activeMonth]);

  // ─── Table data ────────────────────────────────────────────────────────
  const yearData = useMemo(() => data.filter((r) => r.periodo.startsWith(`${activeYear}-`)), [data, activeYear]);

  const tableRows = useMemo(() => {
    if (tableView === "ytd") {
      const all = aggregatePerYear(data, lastMonth);
      return compYears.length > 0 ? all.filter((r) => compYears.includes(parseInt(r.key, 10))) : all;
    }
    if (tableView === "anual") {
      const all = aggregatePerYear(data);
      return compYears.length > 0 ? all.filter((r) => compYears.includes(parseInt(r.key, 10))) : all;
    }
    return aggregateDetail(yearData, granularity);
  }, [data, yearData, granularity, tableView, lastMonth, compYears]);

  // Delta: last vs second-to-last in tableRows
  const deltaRow = useMemo(() => {
    if (tableRows.length < 2) return null;
    const cur = tableRows[tableRows.length - 1];
    const prev = tableRows[tableRows.length - 2];
    const d = (ck: keyof AggRow, pk: keyof AggRow) => {
      const cv = cur[ck] as number, pv = prev[pk] as number;
      return pv !== 0 ? pctDelta(cv, pv) : null;
    };
    return {
      label: `Δ% ${cur.key} vs ${prev.key}`,
      cobrosEfectivo: d("cobrosEfectivo","cobrosEfectivo"), cobrosBancoProvincia: d("cobrosBancoProvincia","cobrosBancoProvincia"),
      cobrosBancoSantander: d("cobrosBancoSantander","cobrosBancoSantander"), cobrosMP: d("cobrosMP","cobrosMP"),
      totalCobros: d("totalCobros","totalCobros"),
      pagosProveedores: d("pagosProveedores","pagosProveedores"), pagosSueldos: d("pagosSueldos","pagosSueldos"),
      pagosImpuestos: d("pagosImpuestos","pagosImpuestos"), pagosGastosFinancieros: d("pagosGastosFinancieros","pagosGastosFinancieros"),
      pagosTarjetas: d("pagosTarjetas","pagosTarjetas"), totalPagos: d("totalPagos","totalPagos"),
      flujoNeto: d("flujoNeto","flujoNeto"), retirosSocios: d("retirosSocios","retirosSocios"),
      transferencias: d("transferencias","transferencias"), financiamientoRecibido: d("financiamientoRecibido","financiamientoRecibido"),
    };
  }, [tableRows]);

  const ytdBadgeText = `YTD al ${String(lastDay).padStart(2, "0")}/${String(lastMonth).padStart(2, "0")}`;

  // ─── Chart data (independent filter) ───────────────────────────────────
  const chartData = useMemo(() => {
    let rows: FlujoDeFondosRow[];
    if (chartRange === "all") rows = data;
    else if (chartRange === "12m") rows = data.slice(-12);
    else rows = data.filter((r) => r.periodo.startsWith(`${activeChartYear}-`));
    if (rows.length === 0) rows = data.slice(-12);
    return rows.map((r) => {
      const [y, m] = r.periodo.split("-");
      return { ...r, label: chartRange === "all" ? `${SHORT_MONTHS[parseInt(m, 10) - 1]} ${y.slice(2)}` : SHORT_MONTHS[parseInt(m, 10) - 1] ?? m };
    });
  }, [data, activeChartYear, chartRange]);

  const chartDataAccum = useMemo(() => {
    let acc = 0;
    return chartData.map((r) => { acc += r.flujoNeto; return { ...r, acumAnual: acc }; });
  }, [chartData]);

  // toggle year in compYears
  const toggleCompYear = (y: number) => {
    setCompYears((prev) => prev.includes(y) ? prev.filter((x) => x !== y) : [...prev, y].sort((a, b) => a - b));
  };

  // ─── Render ────────────────────────────────────────────────────────────

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /><span className="ml-3 text-muted-foreground">Cargando datos...</span></div>;
  if (error) return <Card><CardContent className="flex items-center gap-3 py-8"><AlertCircle className="h-5 w-5 text-red-500" /><p className="text-sm">{error}</p></CardContent></Card>;
  if (raw.length === 0) return <Card><CardContent className="py-8 text-center"><AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-medium">Sin datos de flujo de fondos</p></CardContent></Card>;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Flujo de Fondos</h1>
          <p className="text-muted-foreground mt-1">Método directo — {activeYear}{adjusted && <span className="ml-2 text-xs text-amber-600">(pesos constantes)</span>}</p>
        </div>
        <InflationToggle />
      </div>

      {/* ═══ SECCIÓN 1: KPIs ═══════════════════════════════════════════════ */}

      {/* Fila 1: YTD — all black except flujo neto */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title={`Cobros operativos (${ytdBadgeText})`} value={cobrosYtd} delta={cobrosPrevYtd > 0 ? pctDelta(cobrosYtd, cobrosPrevYtd) : null} />
        <KpiCard title={`Pagos operativos (${ytdBadgeText})`} value={pagosYtd} delta={pagosPrevYtd > 0 ? pctDelta(pagosYtd, pagosPrevYtd) : null} invertDelta />
        <KpiCard title={`Flujo neto operativo (${ytdBadgeText})`} value={flujoNetoYtd} delta={flujoNetoPrevYtd !== 0 ? pctDelta(flujoNetoYtd, flujoNetoPrevYtd) : null} netoColor />
        <KpiCard title={`Financiamiento recibido (${ytdBadgeText})`} value={financYtd} delta={financPrevYtd > 0 ? pctDelta(financYtd, financPrevYtd) : null} subtitle={financMonths > 0 ? `${financMonths} ${financMonths === 1 ? "mes" : "meses"} con desembolso` : "Sin desembolsos"} />
      </div>

      {/* Fila 2: Mes — all black except flujo neto */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-muted-foreground">Mes seleccionado:</p>
          <select value={activeMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="rounded-md border bg-background px-3 py-1.5 text-sm">
            {availableMonths.map((p) => <option key={p} value={p}>{periodoLabel(p)}</option>)}
          </select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title={`Cobros — ${monthRow ? periodoLabel(monthRow.periodo) : ""}`} value={monthRow?.totalCobros ?? 0} delta={prevYearMonth && monthRow ? pctDelta(monthRow.totalCobros, prevYearMonth.totalCobros) : null} />
          <KpiCard title={`Pagos — ${monthRow ? periodoLabel(monthRow.periodo) : ""}`} value={monthRow?.totalPagos ?? 0} delta={prevYearMonth && monthRow ? pctDelta(monthRow.totalPagos, prevYearMonth.totalPagos) : null} invertDelta />
          <KpiCard title={`Flujo neto — ${monthRow ? periodoLabel(monthRow.periodo) : ""}`} value={monthRow?.flujoNeto ?? 0} delta={prevYearMonth && monthRow && prevYearMonth.flujoNeto !== 0 ? pctDelta(monthRow.flujoNeto, prevYearMonth.flujoNeto) : null} netoColor />
          <KpiCard title={`Retiros socios — ${monthRow ? periodoLabel(monthRow.periodo) : ""}`} value={monthRow?.retirosSocios ?? 0} delta={prevYearMonth && monthRow && prevYearMonth.retirosSocios > 0 ? pctDelta(monthRow.retirosSocios, prevYearMonth.retirosSocios) : null} invertDelta />
        </div>
      </div>

      {/* ═══ SECCIÓN 2: Cuadro comparativo ════════════════════════════════ */}
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">Cuadro comparativo</CardTitle>
              <Badge variant="secondary" className="text-[10px]">{ytdBadgeText}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {tableView === "detalle" ? (
                <select value={activeYear} onChange={(e) => setSelectedYear(Number(e.target.value))} className="rounded-md border bg-background px-3 py-1.5 text-sm">
                  {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              ) : (
                /* Multi-year checkboxes for comparison views */
                <div className="flex items-center gap-1.5 flex-wrap">
                  {availableYears.map((y) => (
                    <label key={y} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs cursor-pointer transition-colors ${compYears.includes(y) ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                      <input type="checkbox" checked={compYears.includes(y)} onChange={() => toggleCompYear(y)} className="sr-only" />
                      {y}
                    </label>
                  ))}
                </div>
              )}
              {tableView === "detalle" && (
                <Seg options={["mensual","trimestral","anual"] as Granularity[]} value={granularity} onChange={setGranularity} />
              )}
              <Seg options={["detalle","ytd","anual"] as TableView[]} value={tableView} onChange={setTableView} labels={{ detalle: "Detalle", ytd: "Comp. YTD", anual: "Comp. Anual" }} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-0">
                  <TableHead rowSpan={2} className="sticky left-0 bg-background z-20 align-bottom border-r">Periodo</TableHead>
                  <TableHead colSpan={5} className="text-center text-xs font-medium bg-green-50/50 dark:bg-green-950/20 border-b">COBROS</TableHead>
                  <TableHead colSpan={6} className="text-center text-xs font-medium bg-red-50/50 dark:bg-red-950/20 border-b">EGRESOS</TableHead>
                  <TableHead rowSpan={2} className="text-right align-bottom font-semibold">Flujo Neto</TableHead>
                  <TableHead colSpan={3} className="text-center text-xs font-medium bg-muted/30 border-b">NO OPERACIONAL</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="text-right bg-green-50/50 dark:bg-green-950/20">Efectivo</TableHead>
                  <TableHead className="text-right bg-green-50/50 dark:bg-green-950/20">Bco.Prov</TableHead>
                  <TableHead className="text-right bg-green-50/50 dark:bg-green-950/20">Bco.Sant</TableHead>
                  <TableHead className="text-right bg-green-50/50 dark:bg-green-950/20">MP</TableHead>
                  <TableHead className="text-right font-semibold bg-green-50/50 dark:bg-green-950/20">Total</TableHead>
                  <TableHead className="text-right bg-red-50/50 dark:bg-red-950/20">Proveedores</TableHead>
                  <TableHead className="text-right bg-red-50/50 dark:bg-red-950/20">Sueldos</TableHead>
                  <TableHead className="text-right bg-red-50/50 dark:bg-red-950/20">Impuestos</TableHead>
                  <TableHead className="text-right bg-red-50/50 dark:bg-red-950/20">Gtos.Fin.</TableHead>
                  <TableHead className="text-right bg-red-50/50 dark:bg-red-950/20">Tarjetas</TableHead>
                  <TableHead className="text-right font-semibold bg-red-50/50 dark:bg-red-950/20">Total</TableHead>
                  <TableHead className="text-right bg-muted/30">Retiros</TableHead>
                  <TableHead className="text-right bg-muted/30">Transf.</TableHead>
                  <TableHead className="text-right bg-muted/30">Financ.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((r, idx) => (
                  <TableRow key={r.key} className={idx % 2 === 0 ? "bg-muted/20" : ""}>
                    <TableCell className="sticky left-0 z-20 border-r font-medium whitespace-nowrap bg-background">{r.label}</TableCell>
                    <TableCell className="text-right"><Ars value={r.cobrosEfectivo} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.cobrosBancoProvincia} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.cobrosBancoSantander} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.cobrosMP} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.totalCobros} bold /></TableCell>
                    <TableCell className="text-right"><Ars value={r.pagosProveedores} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.pagosSueldos} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.pagosImpuestos} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.pagosGastosFinancieros} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.pagosTarjetas} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.totalPagos} bold /></TableCell>
                    <TableCell className="text-right"><Ars value={r.flujoNeto} bold neto /></TableCell>
                    <TableCell className="text-right"><Ars value={r.retirosSocios} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.transferencias} /></TableCell>
                    <TableCell className="text-right"><Ars value={r.financiamientoRecibido} /></TableCell>
                  </TableRow>
                ))}
                {deltaRow && (
                  <TableRow className="border-t-2 bg-muted/50">
                    <TableCell className="sticky left-0 z-20 border-r bg-muted/50 font-semibold text-xs">{deltaRow.label}</TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.cobrosEfectivo} favorable="higher" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.cobrosBancoProvincia} favorable="higher" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.cobrosBancoSantander} favorable="higher" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.cobrosMP} favorable="higher" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.totalCobros} favorable="higher" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.pagosProveedores} favorable="lower" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.pagosSueldos} favorable="lower" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.pagosImpuestos} favorable="lower" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.pagosGastosFinancieros} favorable="lower" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.pagosTarjetas} favorable="lower" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.totalPagos} favorable="lower" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.flujoNeto} favorable="higher" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.retirosSocios} favorable="lower" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.transferencias} favorable="lower" /></TableCell>
                    <TableCell className="text-right"><DeltaCell value={deltaRow.financiamientoRecibido} favorable="higher" /></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ═══ SECCIÓN 3: Gráficos — full width, own filters ══════════════ */}
      <div className="space-y-6">
        {/* Chart filter bar */}
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-muted-foreground">Gráficos:</p>
          <select value={activeChartYear} onChange={(e) => { setChartYear(Number(e.target.value)); setChartRange("year"); }} className="rounded-md border bg-background px-3 py-1.5 text-sm">
            {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <Seg options={["year","12m","all"] as ChartRange[]} value={chartRange} onChange={setChartRange} labels={{ year: "Año completo", "12m": "Últimos 12m", all: "Todos" }} />
        </div>

        {/* 1. Cobros vs Pagos */}
        <Card>
          <CardHeader><CardTitle className="text-base">Cobros vs Pagos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} tickLine={false} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} tickLine={false} />
                <Tooltip formatter={arsTooltip} /><Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                <Bar dataKey="totalCobros" name="Cobros" fill={COLORS.cobros} radius={[3, 3, 0, 0]} />
                <Bar dataKey="totalPagos" name="Pagos" fill={COLORS.pagos} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 2. Composición de egresos */}
        <Card>
          <CardHeader><CardTitle className="text-base">Composición de egresos</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} tickLine={false} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} tickLine={false} />
                <Tooltip formatter={arsTooltip} /><Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="pagosProveedores" name="Proveedores" stackId="1" fill={COLORS.proveedores} stroke={COLORS.proveedores} fillOpacity={0.7} />
                <Area type="monotone" dataKey="pagosSueldos" name="Sueldos" stackId="1" fill={COLORS.sueldos} stroke={COLORS.sueldos} fillOpacity={0.7} />
                <Area type="monotone" dataKey="pagosImpuestos" name="Impuestos" stackId="1" fill={COLORS.impuestos} stroke={COLORS.impuestos} fillOpacity={0.7} />
                <Area type="monotone" dataKey="pagosGastosFinancieros" name="Gtos. Fin." stackId="1" fill={COLORS.financieros} stroke={COLORS.financieros} fillOpacity={0.7} />
                <Area type="monotone" dataKey="pagosTarjetas" name="Tarjetas" stackId="1" fill={COLORS.tarjetas} stroke={COLORS.tarjetas} fillOpacity={0.7} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 3. Flujo neto mensual (NEW — green/red bars) */}
        <Card>
          <CardHeader><CardTitle className="text-base">Flujo neto mensual</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} tickLine={false} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} tickLine={false} />
                <Tooltip formatter={arsTooltip} />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                <Bar dataKey="flujoNeto" name="Flujo Neto" radius={[3, 3, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.flujoNeto >= 0 ? COLORS.cobros : COLORS.pagos} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 4. Flujo neto acumulado */}
        <Card>
          <CardHeader><CardTitle className="text-base">Flujo neto acumulado</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartDataAccum}>
                <defs>
                  <linearGradient id="gradPos" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.cobros} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={COLORS.cobros} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} tickLine={false} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} tickLine={false} />
                <Tooltip formatter={arsTooltip} />
                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="acumAnual" name="Acumulado" stroke={COLORS.neto} fill="url(#gradPos)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 5. Cobros por fuente */}
        <Card>
          <CardHeader><CardTitle className="text-base">Cobros por fuente</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} tickLine={false} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} tickLine={false} />
                <Tooltip formatter={arsTooltip} /><Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="cobrosEfectivo" name="Efectivo" stackId="1" fill={COLORS.efectivo} stroke={COLORS.efectivo} fillOpacity={0.7} />
                <Area type="monotone" dataKey="cobrosBanco" name="Banco" stackId="1" fill={COLORS.banco} stroke={COLORS.banco} fillOpacity={0.7} />
                <Area type="monotone" dataKey="cobrosMP" name="Mercado Pago" stackId="1" fill={COLORS.mp} stroke={COLORS.mp} fillOpacity={0.7} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ═══ SECCIÓN 4: Análisis por categoría ════════════════════════════ */}
      {availableYears.length > 0 && (
        <DetallePorCategoria availableYears={availableYears} adjust={adjust} flujoData={data} activeYear={activeYear} />
      )}
    </div>
  );
}

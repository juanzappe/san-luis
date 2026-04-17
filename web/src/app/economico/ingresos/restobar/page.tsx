"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, Coffee, ShoppingBag, Hash, Info, ChevronDown } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import { MonthSelector } from "@/components/month-selector";
import {
  type RestobarData, type HeatmapCell, type TicketDowRow,
  fetchRestobar, fetchRestobarTicketPorDow,
  formatARS, periodoLabel, dayName, hourLabel,
} from "@/lib/units-queries";
import { pctDelta, formatPct } from "@/lib/economic-queries";
import {
  type YtdCutoff,
  type UnitParcial,
  fetchFechaCorteYtd,
  fetchRestobarMesParcial,
  ytdMonthRangeLabel,
} from "@/lib/ytd-cutoff";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const SHORT_MONTHS = [
  "Ene","Feb","Mar","Abr","May","Jun",
  "Jul","Ago","Sep","Oct","Nov","Dic",
];

const YEAR_COLORS = ["#94a3b8", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444"];

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

interface AggRow {
  periodo: string;
  monto: number;
  cantidad: number;
  txCount: number;
  diasConVenta: number;
}

function aggregateMonthly(data: AggRow[], g: Granularity, ytdLastMonth?: number): AggRow[] {
  if (g === "mensual") return data;
  let source = data;
  if (g === "ytd" && ytdLastMonth) {
    source = data.filter((r) => {
      const m = parseInt(r.periodo.split("-")[1], 10);
      return m >= 1 && m <= ytdLastMonth;
    });
  }
  const buckets = new Map<string, AggRow>();
  for (const r of source) {
    const [y, m] = r.periodo.split("-");
    const key = g === "trimestral" ? `${y}-${QUARTER_MAP[m]}` : y;
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, { ...r, periodo: key });
    } else {
      cur.monto += r.monto;
      cur.cantidad += r.cantidad;
      cur.txCount += r.txCount;
      cur.diasConVenta += r.diasConVenta;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.periodo.localeCompare(b.periodo));
}

function granularityLabel(p: string, g: Granularity, ytdLastMonth?: number, cutoff?: YtdCutoff | null): string {
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
// Compact ARS formatter
// ---------------------------------------------------------------------------
function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return formatARS(n);
}

// ---------------------------------------------------------------------------
// Heatmap component — toggle entre cantidad de ventas y monto $.
// Domingo excluido (Restobar no abre los domingos).
// ---------------------------------------------------------------------------
type HeatmapMetric = "count" | "monto";

function Heatmap({ cells, metric }: { cells: HeatmapCell[]; metric: HeatmapMetric }) {
  const valueOf = (c: HeatmapCell) => metric === "count" ? c.count : c.monto;
  const { minVal, maxVal } = useMemo(() => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const c of cells) {
      if (c.day === 0) continue;
      const v = valueOf(c);
      if (v > 0) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    return {
      minVal: mn === Infinity ? 0 : mn,
      maxVal: mx === -Infinity ? 0 : mx,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, metric]);

  const days = [1, 2, 3, 4, 5, 6]; // Lun..Sáb — restobar no abre domingos
  const hours = Array.from({ length: 15 }, (_, i) => i + 8);

  const cellMap = useMemo(() => {
    const m = new Map<string, HeatmapCell>();
    for (const c of cells) m.set(`${c.day}|${c.hour}`, c);
    return m;
  }, [cells]);

  const renderValue = (v: number) => metric === "count" ? v.toString() : formatCompact(v);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="px-1 py-1 text-left sticky left-0 z-10 bg-card" />
              {hours.map((h) => (
                <th key={h} className="px-1 py-1 text-center">{hourLabel(h)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td className="px-1 py-1 font-medium sticky left-0 z-10 bg-card">{dayName(d)}</td>
                {hours.map((h) => {
                  const cell = cellMap.get(`${d}|${h}`);
                  const v = cell ? valueOf(cell) : 0;
                  const intensity = maxVal > 0 ? v / maxVal : 0;
                  return (
                    <td key={h} className="px-1 py-1">
                      <div
                        className="rounded h-8 flex items-center justify-center text-[10px]"
                        style={{
                          backgroundColor: intensity > 0
                            ? `rgba(6, 182, 212, ${0.1 + intensity * 0.85})`
                            : "#f3f4f6",
                          color: intensity > 0.5 ? "white" : "#6b7280",
                        }}
                        title={cell ? `${formatARS(cell.monto)} · ${cell.count} ventas` : "Sin datos"}
                      >
                        {cell ? renderValue(v) : ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <span>Min: {renderValue(minVal)}</span>
        <div className="flex h-3 w-40 overflow-hidden rounded border">
          {[0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((o) => (
            <div key={o} className="flex-1" style={{ backgroundColor: `rgba(6, 182, 212, ${o})` }} />
          ))}
        </div>
        <span>Max: {renderValue(maxVal)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info callout
// ---------------------------------------------------------------------------
function RestobarCallout({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <Card className="border-l-4 border-l-primary">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0 text-primary" />
          <CardTitle className="text-sm font-semibold">Cómo leer esta página</CardTitle>
        </div>
        <button
          onClick={onToggle}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label={collapsed ? "Expandir explicación" : "Colapsar explicación"}
          aria-expanded={!collapsed}
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
          />
        </button>
      </CardHeader>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          collapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="overflow-hidden">
          <CardContent className="pt-0 text-sm space-y-2">
            <p>
              Ventas del Restobar provenientes del POS principal (tagged como <code>restobar</code>). La integración con <strong>POSberry</strong> (POS específico del Restobar) está pendiente — sin ella no hay detalle por plato/horario refinado.
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>
                <strong className="text-foreground">Facturación diaria promedio</strong>: monto / días con venta (Restobar no abre domingos — descontados).
              </li>
              <li>
                <strong className="text-foreground">Ajuste por inflación</strong>: toggle arriba a la derecha. Sin él, comparar meses distantes engaña.
              </li>
              <li>
                <strong className="text-foreground">Heatmap</strong>: alternás entre &ldquo;cantidad de ventas&rdquo; y &ldquo;monto $&rdquo;. Domingo excluido.
              </li>
              <li>
                <strong className="text-foreground">Ticket por día de la semana</strong>: promedio de tickets diarios por DOW (un sábado excepcional no arrastra el promedio).
              </li>
            </ul>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function RestobarPage() {
  const [data, setData] = useState<RestobarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();
  const [granularity, setGranularity] = useState<Granularity>("mensual");

  // YTD day-level cutoff
  const [ytdCutoff, setYtdCutoff] = useState<YtdCutoff | null>(null);
  const [ytdPartialRaw, setYtdPartialRaw] = useState<Map<string, UnitParcial>>(new Map());
  const [isInfoCollapsed, setIsInfoCollapsed] = useState(false);
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>("count");
  const [ticketDow, setTicketDow] = useState<TicketDowRow[]>([]);

  useEffect(() => {
    fetchRestobar()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
    // Fetch YTD cutoff and partial-month data
    fetchFechaCorteYtd().then((c) => {
      if (!c) return;
      setYtdCutoff(c);
      if (!c.esFindeMes) {
        fetchRestobarMesParcial(c.mes, c.dia).then(setYtdPartialRaw);
      }
    });
    // Ticket promedio por DOW (nuevo RPC — promedio de tickets diarios)
    fetchRestobarTicketPorDow().then(setTicketDow).catch(() => {});
  }, []);

  // Inflation-adjusted monthly data
  const adjMonthly = useMemo(
    () => (data?.monthly ?? []).map((r) => ({
      ...r,
      monto: adjust(r.monto, r.periodo),
    })),
    [data, adjust],
  );

  // Inflation-adjusted partial data for YTD cutoff
  const ytdPartialMap = useMemo(() => {
    const map = new Map<string, UnitParcial>();
    ytdPartialRaw.forEach((v, k) => {
      map.set(k, {
        periodo: v.periodo,
        monto: adjust(v.monto, v.periodo),
        cantidad: v.cantidad,
        txCount: v.txCount,
      });
    });
    return map;
  }, [ytdPartialRaw, adjust]);

  // YTD: last month with data in the most recent year
  const ytdLastMonth = useMemo(() => {
    if (adjMonthly.length === 0) return 0;
    const years = Array.from(new Set(adjMonthly.map((r) => r.periodo.slice(0, 4)))).sort();
    const lastYear = years[years.length - 1];
    let max = 0;
    for (const r of adjMonthly) {
      if (r.periodo.startsWith(lastYear)) {
        const m = parseInt(r.periodo.split("-")[1], 10);
        if (m > max) max = m;
      }
    }
    return max;
  }, [adjMonthly]);

  // YTD-adjusted data: replace cutoff month with partial data when in YTD mode
  const ytdAdjusted = useMemo(() => {
    if (!ytdCutoff || ytdCutoff.esFindeMes || ytdPartialMap.size === 0) return adjMonthly;
    const cutoffMonth = String(ytdCutoff.mes).padStart(2, "0");
    return adjMonthly.map((r) => {
      const m = r.periodo.split("-")[1];
      if (m !== cutoffMonth) return r;
      const partial = ytdPartialMap.get(r.periodo);
      if (!partial) return r;
      return { ...r, monto: partial.monto, cantidad: partial.cantidad, txCount: partial.txCount };
    });
  }, [adjMonthly, ytdCutoff, ytdPartialMap]);

  // Aggregated for table (Section 2)
  const dataForAgg = granularity === "ytd" ? ytdAdjusted : adjMonthly;
  const aggregated = useMemo(() => aggregateMonthly(dataForAgg, granularity, ytdLastMonth), [dataForAgg, granularity, ytdLastMonth]);
  const tableRows = useMemo(() => [...aggregated].reverse(), [aggregated]);

  // KPI data (Section 1)
  const [selectedPeriodo, setSelectedPeriodo] = useState("");
  const periodos = adjMonthly.map((r) => r.periodo);
  const activePeriodo = selectedPeriodo || periodos[periodos.length - 1] || "";
  const selectedIdx = adjMonthly.findIndex((r) => r.periodo === activePeriodo);
  const last = selectedIdx >= 0 ? adjMonthly[selectedIdx] : (adjMonthly.length > 0 ? adjMonthly[adjMonthly.length - 1] : null);
  const prev = selectedIdx >= 1 ? adjMonthly[selectedIdx - 1] : null;
  // Ticket promedio = monto / días con venta (facturación por día de operación)
  const lastTicket = last && last.diasConVenta > 0 ? last.monto / last.diasConVenta : 0;
  const prevTicket = prev && prev.diasConVenta > 0 ? prev.monto / prev.diasConVenta : 0;
  // Mismo mes año anterior — para delta YoY en KPIs
  const prevYearPeriodo = last
    ? `${parseInt(last.periodo.slice(0, 4), 10) - 1}-${last.periodo.slice(5, 7)}`
    : "";
  const prevYear = adjMonthly.find((r) => r.periodo === prevYearPeriodo) ?? null;
  const prevYearTicket = prevYear && prevYear.diasConVenta > 0 ? prevYear.monto / prevYear.diasConVenta : 0;

  // Ticket por día de la semana (Lun..Sáb — domingo excluido)
  const ticketPorDia = useMemo(() => {
    const DAY_ORDER = [1, 2, 3, 4, 5, 6];
    const byDow = new Map<number, TicketDowRow>();
    for (const r of ticketDow) byDow.set(r.dow, r);
    return DAY_ORDER.map((d) => {
      const r = byDow.get(d);
      return {
        dia: dayName(d),
        ticket: r ? r.ticketPromedio : 0,
        dias: r ? r.diasConVenta : 0,
      };
    });
  }, [ticketDow]);

  // Nominal vs Real — dos series superpuestas últimos 24 meses
  const nominalVsReal = useMemo(() => {
    const rawByPeriodo = new Map((data?.monthly ?? []).map((r) => [r.periodo, r.monto]));
    return adjMonthly.slice(-24).map((r) => ({
      periodo: r.periodo,
      label: r.periodo.slice(5, 7) + "/" + r.periodo.slice(2, 4),
      nominal: rawByPeriodo.get(r.periodo) ?? 0,
      real: r.monto,
    }));
  }, [data, adjMonthly]);

  // Year-over-year data (Section 3)
  const yoyData = useMemo(() => {
    const years = Array.from(new Set(adjMonthly.map((m) => m.periodo.slice(0, 4)))).sort();
    const byMonth = Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, number | string> = { month: SHORT_MONTHS[i] };
      for (const y of years) {
        const match = adjMonthly.find((m) => m.periodo === `${y}-${String(i + 1).padStart(2, "0")}`);
        if (match) row[y] = match.monto;
      }
      return row;
    });
    return { data: byMonth, years };
  }, [adjMonthly]);

  // Year-over-year tx count data (Section 3b)
  const yoyTxData = useMemo(() => {
    const years = Array.from(new Set(adjMonthly.map((m) => m.periodo.slice(0, 4)))).sort();
    const byMonth = Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, number | string> = { month: SHORT_MONTHS[i] };
      for (const y of years) {
        const match = adjMonthly.find((m) => m.periodo === `${y}-${String(i + 1).padStart(2, "0")}`);
        if (match) row[y] = match.txCount;
      }
      return row;
    });
    return { data: byMonth, years };
  }, [adjMonthly]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando datos…</span>
      </div>
    );
  }
  if (error || !data) {
    return (
      <Card><CardContent className="flex items-center gap-3 py-8">
        <AlertCircle className="h-5 w-5 text-red-500" /><p className="text-sm">{error}</p>
      </CardContent></Card>
    );
  }
  if (adjMonthly.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin datos de restobar</p>
        <p className="text-sm text-muted-foreground">Ejecutá el ETL para importar ventas POS.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ingresos — Restobar</h1>
          <p className="text-muted-foreground">Ventas, ticket promedio y horarios pico — Restobar</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector periodos={periodos} value={activePeriodo} onChange={setSelectedPeriodo} />
          <InflationToggle />
        </div>
      </div>

      {/* Info callout */}
      <RestobarCallout
        collapsed={isInfoCollapsed}
        onToggle={() => setIsInfoCollapsed((v) => !v)}
      />

      {/* ====== SECTION 1: KPI Cards ====== */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ventas Último Mes</CardTitle>
            <Coffee className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(last?.monto ?? 0)}</div>
            {last && prev && (
              <p className={`text-xs ${(pctDelta(last.monto, prev.monto) ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPct(pctDelta(last.monto, prev.monto))} vs mes anterior
              </p>
            )}
            {last && prevYear && (
              <p className={`text-xs ${(pctDelta(last.monto, prevYear.monto) ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPct(pctDelta(last.monto, prevYear.monto))} vs mismo mes año anterior
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Transacciones Último Mes</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(last?.txCount ?? 0).toLocaleString("es-AR")}</div>
            {last && prev && (
              <p className={`text-xs ${(pctDelta(last.txCount, prev.txCount) ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPct(pctDelta(last.txCount, prev.txCount))} vs mes anterior
              </p>
            )}
            {last && prevYear && prevYear.txCount > 0 && (
              <p className={`text-xs ${(pctDelta(last.txCount, prevYear.txCount) ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPct(pctDelta(last.txCount, prevYear.txCount))} vs mismo mes año anterior
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturación Diaria Promedio</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(lastTicket)}</div>
            <p className="text-[11px] text-muted-foreground">
              {last?.diasConVenta ?? 0} días con venta
            </p>
            {prevTicket > 0 && (
              <p className={`text-xs ${(pctDelta(lastTicket, prevTicket) ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPct(pctDelta(lastTicket, prevTicket))} vs mes anterior
              </p>
            )}
            {prevYearTicket > 0 && (
              <p className={`text-xs ${(pctDelta(lastTicket, prevYearTicket) ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPct(pctDelta(lastTicket, prevYearTicket))} vs mismo mes año anterior
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ====== SECTION 2: Detail Table ====== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Detalle por Período</CardTitle>
          <div className="flex items-center rounded-lg border text-xs font-medium">
            {(["mensual", "trimestral", "anual", "ytd"] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  granularity === g ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                {g === "ytd" ? "YTD" : g.charAt(0).toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px] sticky left-0 z-20 bg-card">Período</TableHead>
                  <TableHead className="text-right">Ventas ($)</TableHead>
                  <TableHead className="text-right w-[80px]">Δ%</TableHead>
                  <TableHead className="text-right">Transacciones</TableHead>
                  <TableHead className="text-right w-[80px]">Δ%</TableHead>
                  <TableHead className="text-right">Facturación/día</TableHead>
                  <TableHead className="text-right w-[80px]">Δ%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((row, idx) => {
                  const prevRow = idx < tableRows.length - 1 ? tableRows[idx + 1] : null;
                  const ticket = row.diasConVenta > 0 ? row.monto / row.diasConVenta : 0;
                  const prevTicketVal = prevRow && prevRow.diasConVenta > 0 ? prevRow.monto / prevRow.diasConVenta : 0;
                  const dVentas = prevRow ? pctDelta(row.monto, prevRow.monto) : null;
                  const dTx = prevRow ? pctDelta(row.txCount, prevRow.txCount) : null;
                  const dTicket = prevTicketVal > 0 ? pctDelta(ticket, prevTicketVal) : null;
                  return (
                    <TableRow key={row.periodo}>
                      <TableCell className="sticky left-0 z-10 bg-card font-medium">{granularityLabel(row.periodo, granularity, ytdLastMonth, ytdCutoff)}</TableCell>
                      <TableCell className="text-right">{formatARS(row.monto)}</TableCell>
                      <TableCell className={`text-right text-xs ${dVentas !== null ? (dVentas >= 0 ? "text-green-600" : "text-red-600") : ""}`}>
                        {formatPct(dVentas)}
                      </TableCell>
                      <TableCell className="text-right">{row.txCount.toLocaleString("es-AR")}</TableCell>
                      <TableCell className={`text-right text-xs ${dTx !== null ? (dTx >= 0 ? "text-green-600" : "text-red-600") : ""}`}>
                        {formatPct(dTx)}
                      </TableCell>
                      <TableCell className="text-right">{formatARS(ticket)}</TableCell>
                      <TableCell className={`text-right text-xs ${dTicket !== null ? (dTicket >= 0 ? "text-green-600" : "text-red-600") : ""}`}>
                        {formatPct(dTicket)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ====== SECTION 3: Year-over-Year Chart ====== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comparación Interanual de Ventas — Restobar</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={yoyData.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              {yoyData.years.map((year, i) => (
                <Line
                  key={year}
                  type="monotone"
                  dataKey={year}
                  name={year}
                  stroke={YEAR_COLORS[i % YEAR_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ====== SECTION 3b: Transactions YoY ====== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transacciones por Mes</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={yoyTxData.data}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Legend />
              {yoyTxData.years.map((year, i) => (
                <Line
                  key={year}
                  type="monotone"
                  dataKey={year}
                  name={year}
                  stroke={YEAR_COLORS[i % YEAR_COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ====== SECTION 4: Heatmap ====== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Mapa de Calor — Día × Hora</CardTitle>
          <div className="flex items-center rounded-lg border text-xs font-medium">
            {(["count", "monto"] as HeatmapMetric[]).map((m) => (
              <button
                key={m}
                onClick={() => setHeatmapMetric(m)}
                className={`px-3 py-1.5 transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  heatmapMetric === m ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                {m === "count" ? "Cant. ventas" : "Monto $"}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {data.heatmap.length > 0 ? (
            <Heatmap cells={data.heatmap} metric={heatmapMetric} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Sin datos horarios disponibles</p>
          )}
        </CardContent>
      </Card>

      {/* ====== SECTION 4b: Ticket por día de la semana ====== */}
      {ticketPorDia.some((d) => d.ticket > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ticket Promedio por Día de la Semana</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={ticketPorDia}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="dia" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => formatCompact(Number(v))} />
                <Tooltip formatter={arsTooltip} />
                <Bar dataKey="ticket" name="Ticket promedio" fill="#06b6d4" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Para cada fecha se calcula <em>ticket = monto / transacciones</em>. Después se promedian los tickets diarios agrupando por día de la semana. Domingo excluido (Restobar cerrado). All-time en nominal — usar para la <strong>forma</strong> relativa entre días.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ====== SECTION 5: Nominal vs Real ====== */}
      {nominalVsReal.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Crecimiento Nominal vs Real</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={nominalVsReal}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => formatCompact(Number(v))} />
                <Tooltip formatter={arsTooltip} labelFormatter={(l) => `Mes ${l}`} />
                <Legend />
                <Line type="monotone" dataKey="nominal" name="Nominal" stroke="#94a3b8" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="real"    name="Real (ajustado por IPC)" stroke="#06b6d4" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Ventas mensuales últimos 24 meses. La línea nominal son los pesos que facturás; la real los lleva al último mes con IPC. Si la real crece pero la nominal más, estás capturando inflación sin crecimiento real. Si la real cae mientras la nominal sube, estás perdiendo poder adquisitivo.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

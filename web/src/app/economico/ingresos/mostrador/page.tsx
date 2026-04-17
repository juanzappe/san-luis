"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, Store, ShoppingBag, Hash, Search, ChevronsUpDown, Info, ChevronDown } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InflationToggle, useInflation } from "@/lib/inflation";
import { MonthSelector } from "@/components/month-selector";
import {
  type MostradorMonthly, type MostradorRankingRow, type ProductoSemanalRow,
  type HeatmapCell, type TicketDowRow,
  fetchMostradorMensual, fetchMostradorHeatmap, fetchProductosLista,
  fetchProductoSemanal, fetchRankingMensual, fetchTicketPorDow,
  formatARS, dayName, hourLabel, periodoLabel,
} from "@/lib/units-queries";
import { pctDelta, formatPct } from "@/lib/economic-queries";
import {
  type YtdCutoff,
  type UnitParcial,
  fetchFechaCorteYtd,
  fetchMostradorMesParcial,
  ytdMonthRangeLabel,
} from "@/lib/ytd-cutoff";
import { cn } from "@/lib/utils";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

const SHORT_MONTHS = [
  "Ene","Feb","Mar","Abr","May","Jun",
  "Jul","Ago","Sep","Oct","Nov","Dic",
];

const YEAR_COLORS = ["#94a3b8", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444"];

// ---------------------------------------------------------------------------
// Period aggregation (same pattern as estado-resultados)
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
// Compact ARS formatter (para celdas del heatmap y leyenda)
// ---------------------------------------------------------------------------
function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return formatARS(n);
}

// ---------------------------------------------------------------------------
// Heatmap component — acepta toggle entre "cantidad de ventas" y "monto $".
// Incluye leyenda con min/max para dar contexto de la escala.
// ---------------------------------------------------------------------------
type HeatmapMetric = "count" | "monto";

function Heatmap({ cells, metric }: { cells: HeatmapCell[]; metric: HeatmapMetric }) {
  const valueOf = useCallback((c: HeatmapCell) => metric === "count" ? c.count : c.monto, [metric]);
  const { minVal, maxVal } = useMemo(() => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const c of cells) {
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
  }, [cells, valueOf]);

  // Lun-Sab (domingo excluido — el local no abre los domingos; las ventas
  // esporádicas de domingo son días especiales como Pascuas o Día de la Madre
  // y distorsionan el promedio).
  const days = [1, 2, 3, 4, 5, 6];
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
                            ? `rgba(139, 92, 246, ${0.1 + intensity * 0.85})`
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
            <div key={o} className="flex-1" style={{ backgroundColor: `rgba(139, 92, 246, ${o})` }} />
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
function MostradorCallout({
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
              Ventas del <strong>punto de venta físico</strong> (POS), netas de IVA. Excluye Restobar (esa UN está en su propia página).
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>
                <strong className="text-foreground">Facturación diaria promedio</strong>: monto del período / días con venta (el local no abre domingos, así que se descuentan). Es el ingreso promedio por día de operación, no el ticket por transacción.
              </li>
              <li>
                <strong className="text-foreground">Ajuste por inflación</strong>: toggle arriba a la derecha. Sin activarlo, comparar meses distantes engaña.
              </li>
              <li>
                <strong className="text-foreground">Mapa de calor</strong>: podés alternar entre &ldquo;cantidad de ventas&rdquo; (volumen de tickets) y &ldquo;monto $&rdquo; (facturación). Los picos pueden caer en horas distintas.
              </li>
              <li>
                <strong className="text-foreground">YTD</strong>: cuando el mes actual está parcial, las filas de años anteriores usan el mismo día de corte para comparación justa.
              </li>
            </ul>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Product Combobox
// ---------------------------------------------------------------------------
function ProductCombobox({
  productos,
  value,
  onChange,
}: {
  productos: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex w-full max-w-md items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
          "hover:bg-accent hover:text-accent-foreground",
          !value && "text-muted-foreground",
        )}
      >
        <span className="truncate">{value || "Buscar producto..."}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0">
        <Command>
          <CommandInput placeholder="Buscar producto..." />
          <CommandList>
            <CommandEmpty>No se encontró el producto.</CommandEmpty>
            <CommandGroup className="max-h-64 overflow-auto">
              {productos.map((p) => (
                <CommandItem
                  key={p}
                  value={p}
                  data-checked={value.toLowerCase() === p.toLowerCase() || undefined}
                  onSelect={(v) => {
                    onChange(v === value.toLowerCase() ? "" : v);
                    setOpen(false);
                  }}
                >
                  {p}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Week label helper
// ---------------------------------------------------------------------------
function weekLabel(semanaInicio: string): string {
  try {
    const d = parseISO(semanaInicio);
    const weekNum = Math.ceil(d.getDate() / 7);
    const mes = format(d, "MMM", { locale: es });
    return `Sem ${weekNum} ${mes.charAt(0).toUpperCase() + mes.slice(1)}`;
  } catch {
    return semanaInicio;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export default function MostradorPage() {
  const { adjust } = useInflation();
  const [monthly, setMonthly] = useState<MostradorMonthly[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [productos, setProductos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [isInfoCollapsed, setIsInfoCollapsed] = useState(false);
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>("count");

  // Section 5: Product search
  const [selectedProduct, setSelectedProduct] = useState("");
  const [weeklyData, setWeeklyData] = useState<ProductoSemanalRow[]>([]);
  const [weeklyLoading, setWeeklyLoading] = useState(false);

  // Section 6: Product ranking
  const [rankingMonth, setRankingMonth] = useState("");
  const [ranking, setRanking] = useState<MostradorRankingRow[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [showAllRanking, setShowAllRanking] = useState(false);

  // YTD day-level cutoff
  const [ytdCutoff, setYtdCutoff] = useState<YtdCutoff | null>(null);
  const [ytdPartialRaw, setYtdPartialRaw] = useState<Map<string, UnitParcial>>(new Map());

  // Ticket promedio por día de la semana (promedio de tickets diarios, no agregado)
  const [ticketDow, setTicketDow] = useState<TicketDowRow[]>([]);


  // Initial load
  useEffect(() => {
    Promise.all([fetchMostradorMensual(), fetchMostradorHeatmap(), fetchProductosLista()])
      .then(([m, h, p]) => {
        setMonthly(m);
        setHeatmap(h);
        setProductos(p);
        if (m.length > 0) setRankingMonth(m[m.length - 1].periodo);
      })
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
    // Fetch YTD cutoff and partial-month data
    fetchFechaCorteYtd().then((c) => {
      if (!c) return;
      setYtdCutoff(c);
      if (!c.esFindeMes) {
        fetchMostradorMesParcial(c.mes, c.dia).then(setYtdPartialRaw);
      }
    });
    // Ticket promedio por DOW (nuevo RPC — promedio de tickets diarios)
    fetchTicketPorDow().then(setTicketDow).catch(() => {});
  }, []);

  // Section 5: fetch weekly on product select
  useEffect(() => {
    if (!selectedProduct) { setWeeklyData([]); return; }
    setWeeklyLoading(true);
    fetchProductoSemanal(selectedProduct)
      .then(setWeeklyData)
      .catch(() => setWeeklyData([]))
      .finally(() => setWeeklyLoading(false));
  }, [selectedProduct]);

  // Section 6: fetch ranking on month change
  useEffect(() => {
    if (!rankingMonth) return;
    setRankingLoading(true);
    setShowAllRanking(false);
    fetchRankingMensual(rankingMonth)
      .then(setRanking)
      .catch(() => setRanking([]))
      .finally(() => setRankingLoading(false));
  }, [rankingMonth]);

  // Inflation-adjusted monthly data
  const adjMonthly = useMemo(
    () => monthly.map((r) => ({
      ...r,
      monto: adjust(r.monto, r.periodo),
    })),
    [monthly, adjust],
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

  // Aggregated data for table (Section 2)
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
  // Ticket promedio = monto / días con venta (promedio de facturación por día
  // de operación). Sin Restobar. No es el "ticket por transacción" — es el
  // ingreso diario promedio cuando el local estuvo abierto.
  const lastTicket = last && last.diasConVenta > 0 ? last.monto / last.diasConVenta : 0;
  const prevTicket = prev && prev.diasConVenta > 0 ? prev.monto / prev.diasConVenta : 0;
  // Mismo mes año anterior — para delta YoY en KPIs
  const prevYearPeriodo = last
    ? `${parseInt(last.periodo.slice(0, 4), 10) - 1}-${last.periodo.slice(5, 7)}`
    : "";
  const prevYear = adjMonthly.find((r) => r.periodo === prevYearPeriodo) ?? null;
  const prevYearTicket = prevYear && prevYear.diasConVenta > 0 ? prevYear.monto / prevYear.diasConVenta : 0;

  // Weekly data ajustado por inflación (semana_inicio da el periodo de referencia)
  const adjWeeklyData = useMemo(
    () => weeklyData.map((w) => ({
      ...w,
      monto: adjust(w.monto, w.semanaInicio.slice(0, 7)),
    })),
    [weeklyData, adjust],
  );

  // Ticket promedio por día de la semana — viene del RPC get_mostrador_ticket_por_dow.
  // Para cada fecha: ticket_diario = monto / transacciones. Después promedia
  // los tickets diarios agrupando por DOW. Domingo (dow=0) se excluye porque
  // el local no abre los domingos (salvo días especiales como Pascuas).
  const ticketPorDia = useMemo(() => {
    const DAY_ORDER = [1, 2, 3, 4, 5, 6]; // Lun..Sáb
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

  // Month options for ranking selector
  const monthOptions = useMemo(() => [...monthly].reverse().map((m) => m.periodo), [monthly]);

  const handleProductChange = useCallback((v: string) => {
    // cmdk lowercases; find the original casing
    const match = productos.find((p) => p.toLowerCase() === v.toLowerCase());
    setSelectedProduct(match ?? v);
  }, [productos]);

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
  if (monthly.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin datos de mostrador</p>
        <p className="text-sm text-muted-foreground">Ejecutá el ETL para importar ventas POS.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ingresos — Mostrador</h1>
          <p className="text-muted-foreground">Ventas POS — productos, tendencias y horarios — Mostrador</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector periodos={periodos} value={activePeriodo} onChange={setSelectedPeriodo} />
          <InflationToggle />
        </div>
      </div>

      {/* Info callout */}
      <MostradorCallout
        collapsed={isInfoCollapsed}
        onToggle={() => setIsInfoCollapsed((v) => !v)}
      />


      {/* ====== SECTION 1: KPI Cards ====== */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ventas Último Mes</CardTitle>
            <Store className="h-4 w-4 text-muted-foreground" />
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
                  // Ticket promedio = monto / días con venta (ingresos diarios por día abierto)
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
          <CardTitle className="text-base">Comparación Interanual de Ventas</CardTitle>
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
          {heatmap.length > 0 ? (
            <Heatmap cells={heatmap} metric={heatmapMetric} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Sin datos horarios disponibles</p>
          )}
        </CardContent>
      </Card>

      {/* ====== SECTION 4b: Ticket Promedio por Día de la Semana ====== */}
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
                <Bar dataKey="ticket" name="Ticket promedio" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Para cada fecha se calcula <em>ticket = monto / transacciones</em>. Después se promedian los tickets diarios agrupando por día de la semana. All-time en nominal — usar para la <strong>forma</strong> relativa entre días. Domingo excluido.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ====== SECTION 5: Product Search + Weekly Evolution ====== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Evolución Semanal por Producto
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProductCombobox
            productos={productos}
            value={selectedProduct}
            onChange={handleProductChange}
          />

          {weeklyLoading && (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Cargando datos semanales…</span>
            </div>
          )}

          {!weeklyLoading && selectedProduct && adjWeeklyData.length > 0 && (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={adjWeeklyData.map((w) => ({
                  label: weekLabel(w.semanaInicio),
                  cantidad: w.cantidad,
                  monto: w.monto,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis yAxisId="left" fontSize={12} />
                  <YAxis yAxisId="right" orientation="right" fontSize={12} tickFormatter={(v) => `${(v / 1e3).toFixed(0)}k`} />
                  <Tooltip formatter={(v, name) => name === "Monto" ? formatARS(Number(v ?? 0)) : Number(v ?? 0).toLocaleString("es-AR")} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="cantidad" name="Cantidad" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="monto" name="Monto" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                </BarChart>
              </ResponsiveContainer>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-20 bg-card">Semana</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="text-right">Promedio diario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adjWeeklyData.map((w) => (
                      <TableRow key={w.semana}>
                        <TableCell className="sticky left-0 z-10 bg-card font-medium">
                          {(() => {
                            try {
                              const start = parseISO(w.semanaInicio);
                              const end = new Date(start);
                              end.setDate(end.getDate() + 6);
                              return `${format(start, "dd/MM", { locale: es })} – ${format(end, "dd/MM", { locale: es })}`;
                            } catch {
                              return w.semana;
                            }
                          })()}
                        </TableCell>
                        <TableCell className="text-right">{w.cantidad.toLocaleString("es-AR", { maximumFractionDigits: 1 })}</TableCell>
                        <TableCell className="text-right">{formatARS(w.monto)}</TableCell>
                        <TableCell className="text-right">{(w.cantidad / 7).toLocaleString("es-AR", { maximumFractionDigits: 1 })}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {!weeklyLoading && selectedProduct && adjWeeklyData.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Sin datos de las últimas 12 semanas para &quot;{selectedProduct}&quot;
            </p>
          )}
        </CardContent>
      </Card>

      {/* ====== SECTION 6: Product Ranking ====== */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">¿Cuánto se vende de cada producto?</CardTitle>
          <select
            value={rankingMonth}
            onChange={(e) => setRankingMonth(e.target.value)}
            className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium"
          >
            {monthOptions.map((p) => (
              <option key={p} value={p}>{periodoLabel(p)}</option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          {rankingLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Cargando ranking…</span>
            </div>
          ) : ranking.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Sin datos para este mes</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px] sticky left-0 z-20 bg-card">#</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Monto total ($)</TableHead>
                      <TableHead className="text-right">Unidades</TableHead>
                      <TableHead className="text-right">Promedio diario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      // Orden por monto descendente (antes era por cantidad)
                      const sorted = [...ranking].sort((a, b) => (b.totalMonto ?? 0) - (a.totalMonto ?? 0));
                      return (showAllRanking ? sorted : sorted.slice(0, 20)).map((r, i) => (
                        <TableRow key={r.producto}>
                          <TableCell className="sticky left-0 z-10 bg-card text-muted-foreground">{i + 1}</TableCell>
                          <TableCell className="font-medium max-w-[260px] truncate" title={r.producto}>{r.producto}</TableCell>
                          <TableCell className="text-right font-medium">{formatARS(r.totalMonto ?? 0)}</TableCell>
                          <TableCell className="text-right">{r.totalCantidad.toLocaleString("es-AR", { maximumFractionDigits: 1 })}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{r.promedioDiario.toLocaleString("es-AR", { maximumFractionDigits: 1 })}</TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              </div>
              {ranking.length > 20 && !showAllRanking && (
                <div className="text-center mt-3">
                  <Button variant="ghost" size="sm" onClick={() => setShowAllRanking(true)}>
                    Ver todos ({ranking.length} productos)
                  </Button>
                </div>
              )}
              {showAllRanking && ranking.length > 20 && (
                <div className="text-center mt-3">
                  <Button variant="ghost" size="sm" onClick={() => setShowAllRanking(false)}>
                    Mostrar solo 20
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

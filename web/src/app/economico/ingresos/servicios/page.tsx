"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  Area, AreaChart,
  ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Loader2, AlertCircle, Briefcase, ShoppingBag, Hash, Search, ChevronsUpDown,
  Info, ChevronDown,
} from "lucide-react";

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
  type ServiciosData, type ServiciosClientRow,
  type TipoServicioMensualRow, type TopRenglonRow, type ClienteTipoRow,
  fetchServicios,
  fetchServiciosTipoMensual, fetchServiciosTopRenglones, fetchServiciosClienteTipo,
  formatARS, periodoLabel,
} from "@/lib/units-queries";
import { pctDelta, formatPct, shortLabel } from "@/lib/economic-queries";
import {
  type YtdCutoff,
  type ServicioParcial,
  fetchFechaCorteYtd,
  fetchServiciosMesParcial,
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

const YEAR_COLORS = ["#94a3b8", "#22c55e", "#3b82f6", "#f59e0b", "#ef4444"];
const PIE_COLORS = ["#3b82f6", "#22c55e"];

// Tipo de servicio — 6 categorías exclusivas (convenio_marco prevalece sobre
// todo si la descripción contiene "renglón"; las demás son mutuamente excluyentes).
// `otros` y `convenio_marco` se excluyen de gráficos de cantidades/precio porque
// sus unidades internas son heterogéneas (mezclan productos distintos).
const TIPO_SERVICIO_ORDER = [
  "viandas",
  "servicio_cafe",
  "catering",
  "mostrador",
  "convenio_marco",
  "otros",
] as const;

const TIPO_SERVICIO_LABEL: Record<string, string> = {
  viandas:         "Viandas",
  servicio_cafe:   "Servicio de café",
  catering:        "Catering",
  mostrador:       "Mostrador",
  convenio_marco:  "Convenio marco",
  otros:           "Otros",
};

const TIPO_SERVICIO_COLOR: Record<string, string> = {
  viandas:         "#3b82f6", // blue
  servicio_cafe:   "#8b5cf6", // violet
  catering:        "#22c55e", // green
  mostrador:       "#ec4899", // pink
  convenio_marco:  "#f59e0b", // amber
  otros:           "#94a3b8", // slate
};

const TIPO_HETEROGENEO = new Set(["otros", "convenio_marco"]);

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
  total: number;
  txCount: number;
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
      cur.total += r.total;
      cur.txCount += r.txCount;
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
// Client Combobox
// ---------------------------------------------------------------------------
function ClientCombobox({
  clients,
  value,
  onChange,
}: {
  clients: ServiciosClientRow[];
  value: string;
  onChange: (cuit: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = clients.find((c) => c.cuit === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "inline-flex w-full max-w-md items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
          "hover:bg-accent hover:text-accent-foreground",
          !value && "text-muted-foreground",
        )}
      >
        <span className="truncate">{selected?.nombre || "Buscar cliente..."}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[450px] p-0">
        <Command>
          <CommandInput placeholder="Buscar por nombre o CUIT..." />
          <CommandList>
            <CommandEmpty>No se encontró el cliente.</CommandEmpty>
            <CommandGroup className="max-h-64 overflow-auto">
              {clients.map((c) => (
                <CommandItem
                  key={c.cuit}
                  value={`${c.nombre} ${c.cuit}`}
                  data-checked={value === c.cuit || undefined}
                  onSelect={() => {
                    onChange(value === c.cuit ? "" : c.cuit);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{c.nombre}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{c.cuit}</span>
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
// Compact ARS formatter (used in heatmap cells)
// ---------------------------------------------------------------------------
function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e9) return `$ ${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$ ${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$ ${(n / 1e3).toFixed(0)}K`;
  return formatARS(n);
}

// ---------------------------------------------------------------------------
// Info callout — "cómo leer esta página"
// ---------------------------------------------------------------------------
function ServiciosCallout({
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
              Catering / facturación B2B — todas las <strong>facturas emitidas por punto de venta 6</strong> (Servicios), agrupadas por fecha de emisión (devengado).
            </p>
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              <li>
                <strong className="text-foreground">Servicios = facturas emitidas</strong>: una factura = un servicio (no necesariamente un evento). Notas de crédito se restan.
              </li>
              <li>
                <strong className="text-foreground">Ticket medio</strong>: facturación / cantidad de facturas. Puede distorsionarse si hay notas de crédito.
              </li>
              <li>
                <strong className="text-foreground">Ajuste por inflación</strong>: toggle arriba a la derecha. Se aplica a todos los montos incluidos Top 10 y heatmap cliente.
              </li>
              <li>
                <strong className="text-foreground">Público vs Privado</strong>: depende del campo <code>tipo_entidad</code> del cliente. Si un cliente no está clasificado, no aparece en ese pie.
              </li>
              <li>
                <strong className="text-foreground">Segmento</strong> (pie &ldquo;Por Segmento&rdquo;): campo <code>clasificacion</code> del cliente (independiente de público/privado — describe tipo de actividad).
              </li>
              <li>
                <strong className="text-foreground">Rotación de clientes</strong>: un cliente es <em>nuevo</em> el primer mes que aparece en toda la historia; <em>recurrente</em> si ya apareció antes.
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
export default function ServiciosPage() {
  const [data, setData] = useState<ServiciosData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();
  const [granularity, setGranularity] = useState<Granularity>("mensual");
  const [selectedClient, setSelectedClient] = useState("");
  const [showAllClients, setShowAllClients] = useState(false);
  const [isInfoCollapsed, setIsInfoCollapsed] = useState(false);

  // YTD day-level cutoff
  const [ytdCutoff, setYtdCutoff] = useState<YtdCutoff | null>(null);
  const [ytdPartialRaw, setYtdPartialRaw] = useState<Map<string, ServicioParcial>>(new Map());

  // Desglose por tipo de servicio (viene de factura_emitida_detalle via RPCs)
  const [tipoMensual, setTipoMensual] = useState<TipoServicioMensualRow[]>([]);
  const [topRenglones, setTopRenglones] = useState<TopRenglonRow[]>([]);
  const [clienteTipo, setClienteTipo] = useState<ClienteTipoRow[]>([]);

  useEffect(() => {
    fetchServicios()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
    // Fetch YTD cutoff and partial-month data
    fetchFechaCorteYtd().then((c) => {
      if (!c) return;
      setYtdCutoff(c);
      if (!c.esFindeMes) {
        fetchServiciosMesParcial(c.mes, c.dia).then(setYtdPartialRaw);
      }
    });
    // Desglose por tipo — tolerate individual failures
    fetchServiciosTipoMensual().then(setTipoMensual).catch(() => {});
    // Renglones agrupados por número (extrae "Renglón N" de la descripción)
    fetchServiciosTopRenglones(25).then(setTopRenglones).catch(() => {});
    fetchServiciosClienteTipo().then(setClienteTipo).catch(() => {});
  }, []);

  // Inflation-adjusted monthly data
  const adjMonthly = useMemo(
    () => (data?.monthly ?? []).map((r) => ({
      ...r,
      total: adjust(r.total, r.periodo),
      publico: adjust(r.publico, r.periodo),
      privado: adjust(r.privado, r.periodo),
    })),
    [data, adjust],
  );

  // Inflation-adjusted partial data for YTD cutoff
  const ytdPartialMap = useMemo(() => {
    const map = new Map<string, ServicioParcial>();
    ytdPartialRaw.forEach((v, k) => {
      map.set(k, {
        periodo: v.periodo,
        publico: adjust(v.publico, v.periodo),
        privado: adjust(v.privado, v.periodo),
        total: adjust(v.total, v.periodo),
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
      return { ...r, total: partial.total, publico: partial.publico, privado: partial.privado, txCount: partial.txCount };
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
  const lastTicket = last && last.txCount > 0 ? last.total / last.txCount : 0;
  const prevTicket = prev && prev.txCount > 0 ? prev.total / prev.txCount : 0;
  // Same month, previous year — for YoY delta on KPIs
  const prevYearPeriodo = last
    ? `${parseInt(last.periodo.slice(0, 4), 10) - 1}-${last.periodo.slice(5, 7)}`
    : "";
  const prevYear = adjMonthly.find((r) => r.periodo === prevYearPeriodo) ?? null;
  const prevYearTicket = prevYear && prevYear.txCount > 0 ? prevYear.total / prevYear.txCount : 0;

  // Year-over-year data (Section 3)
  const yoyData = useMemo(() => {
    const years = Array.from(new Set(adjMonthly.map((m) => m.periodo.slice(0, 4)))).sort();
    const byMonth = Array.from({ length: 12 }, (_, i) => {
      const row: Record<string, number | string> = { month: SHORT_MONTHS[i] };
      for (const y of years) {
        const match = adjMonthly.find((m) => m.periodo === `${y}-${String(i + 1).padStart(2, "0")}`);
        if (match) row[y] = match.total;
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

  // Client evolution data (Section 4)
  const clientEvolution = useMemo(() => {
    if (!selectedClient || !data) return [];
    const rows = data.clientMonthly.get(selectedClient) ?? [];
    return rows.map((r) => ({
      ...r,
      monto: adjust(r.monto, r.periodo),
      label: periodoLabel(r.periodo),
    }));
  }, [selectedClient, data, adjust]);

  const selectedClientData = useMemo(
    () => data?.clients.find((c) => c.cuit === selectedClient),
    [data, selectedClient],
  );

  // Inflation-adjusted client totals — sums each client's per-period monto
  // after applying adjust(). Replaces data.clients (nominal) for display.
  const adjustedClients = useMemo(() => {
    if (!data) return [];
    return data.clients
      .map((c) => {
        const rows = data.clientMonthly.get(c.cuit) ?? [];
        const monto = rows.reduce((s, r) => s + adjust(r.monto, r.periodo), 0);
        return { ...c, monto };
      })
      .sort((a, b) => b.monto - a.monto);
  }, [data, adjust]);

  // Rotación de clientes por mes — últimos 12 meses, con new/recurrent.
  const rotacionData = useMemo(() => {
    if (!data) return [];
    const perMonth = new Map<string, Set<string>>();
    data.clientMonthly.forEach((rows, cuit) => {
      for (const r of rows) {
        if (!perMonth.has(r.periodo)) perMonth.set(r.periodo, new Set());
        perMonth.get(r.periodo)!.add(cuit);
      }
    });
    const allPeriodos = Array.from(perMonth.keys()).sort();
    const seenBefore = new Set<string>();
    const result: { label: string; periodo: string; nuevos: number; recurrentes: number }[] = [];
    for (const periodo of allPeriodos) {
      const thisMonth = perMonth.get(periodo) ?? new Set<string>();
      let nuevos = 0;
      thisMonth.forEach((c) => {
        if (!seenBefore.has(c)) nuevos++;
      });
      const recurrentes = thisMonth.size - nuevos;
      result.push({ periodo, label: shortLabel(periodo), nuevos, recurrentes });
      thisMonth.forEach((c) => seenBefore.add(c));
    }
    return result.slice(-12);
  }, [data]);

  // Concentración Pareto — cumulative % of facturation by client rank (top 50).
  const paretoData = useMemo(() => {
    if (adjustedClients.length === 0) return [];
    const totalSum = adjustedClients.reduce((s, c) => s + c.monto, 0);
    if (totalSum <= 0) return [];
    let cumul = 0;
    return adjustedClients.slice(0, 50).map((c, i) => {
      cumul += c.monto;
      return {
        rank: i + 1,
        clientName: c.nombre,
        pct: (cumul / totalSum) * 100,
      };
    });
  }, [adjustedClients]);

  // Heatmap cliente × mes — top 20 clientes por facturación, últimos 12 meses.
  const clientHeatmap = useMemo(() => {
    if (!data) return { grid: [] as { label: string; cells: (number | null)[] }[], months: [] as string[], min: 0, max: 0 };
    const months = Array.from(new Set(adjMonthly.map((r) => r.periodo))).sort().slice(-12);
    const top20 = adjustedClients.slice(0, 20);
    let min = Infinity;
    let max = -Infinity;
    const grid = top20.map((c) => {
      const rows = data.clientMonthly.get(c.cuit) ?? [];
      const byPeriodo = new Map(rows.map((r) => [r.periodo, r]));
      const cells = months.map((p) => {
        const match = byPeriodo.get(p);
        if (!match) return null;
        const v = adjust(match.monto, p);
        if (v < min) min = v;
        if (v > max) max = v;
        return v;
      });
      return { label: c.nombre, cells };
    });
    return {
      grid,
      months,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
    };
  }, [data, adjustedClients, adjMonthly, adjust]);

  // Histograma de frecuencia — clientes agrupados por cantidad de facturas.
  const freqHistogram = useMemo(() => {
    if (!data) return [];
    const buckets: { label: string; count: number }[] = [
      { label: "1", count: 0 },
      { label: "2-5", count: 0 },
      { label: "6-12", count: 0 },
      { label: "13-24", count: 0 },
      { label: "25+", count: 0 },
    ];
    for (const c of data.clients) {
      const n = c.cantFacturas;
      if (n === 1) buckets[0].count++;
      else if (n <= 5) buckets[1].count++;
      else if (n <= 12) buckets[2].count++;
      else if (n <= 24) buckets[3].count++;
      else buckets[4].count++;
    }
    return buckets;
  }, [data]);

  // Público vs Privado a lo largo del tiempo — últimos 24 meses.
  const pubPrivTimeline = useMemo(() =>
    adjMonthly.slice(-24).map((r) => ({
      label: shortLabel(r.periodo),
      periodo: r.periodo,
      publico: r.publico,
      privado: r.privado,
    })),
  [adjMonthly]);

  // ---- Desglose por Tipo de Servicio — pivots para los 3 gráficos temporales.
  // Cada RPC row viene por (periodo, tipo_servicio). Se suma por (periodo, tipo)
  // y se pivotea a columnas para que cada tipo sea una serie.
  const tipoAreaData = useMemo(() => {
    const byPeriodo = new Map<string, Record<string, number>>();
    for (const r of tipoMensual) {
      if (!byPeriodo.has(r.periodo)) byPeriodo.set(r.periodo, {});
      const bucket = byPeriodo.get(r.periodo)!;
      bucket[r.tipoServicio] = (bucket[r.tipoServicio] ?? 0) + adjust(r.montoNeto, r.periodo);
    }
    const periodos = Array.from(byPeriodo.keys()).sort().slice(-24);
    return periodos.map((p) => {
      const row: Record<string, string | number> = { label: shortLabel(p), periodo: p };
      for (const t of TIPO_SERVICIO_ORDER) {
        row[t] = byPeriodo.get(p)?.[t] ?? 0;
      }
      return row;
    });
  }, [tipoMensual, adjust]);

  const tipoCantidadData = useMemo(() => {
    const byPeriodo = new Map<string, Record<string, number>>();
    for (const r of tipoMensual) {
      if (TIPO_HETEROGENEO.has(r.tipoServicio)) continue;
      if (!byPeriodo.has(r.periodo)) byPeriodo.set(r.periodo, {});
      const bucket = byPeriodo.get(r.periodo)!;
      bucket[r.tipoServicio] = (bucket[r.tipoServicio] ?? 0) + r.cantidad;
    }
    const periodos = Array.from(byPeriodo.keys()).sort().slice(-24);
    return periodos.map((p) => {
      const row: Record<string, string | number> = { label: shortLabel(p), periodo: p };
      for (const t of TIPO_SERVICIO_ORDER) {
        if (TIPO_HETEROGENEO.has(t)) continue;
        row[t] = byPeriodo.get(p)?.[t] ?? 0;
      }
      return row;
    });
  }, [tipoMensual]);

  const tipoPrecioData = useMemo(() => {
    // Precio promedio ajustado: suma monto_neto_ajustado y cantidad por
    // (periodo, tipo) y divide.
    const byPeriodo = new Map<string, Map<string, { monto: number; cantidad: number }>>();
    for (const r of tipoMensual) {
      if (TIPO_HETEROGENEO.has(r.tipoServicio)) continue;
      if (r.cantidad <= 0) continue;
      if (!byPeriodo.has(r.periodo)) byPeriodo.set(r.periodo, new Map());
      const bucket = byPeriodo.get(r.periodo)!;
      const cur = bucket.get(r.tipoServicio) ?? { monto: 0, cantidad: 0 };
      cur.monto += adjust(r.montoNeto, r.periodo);
      cur.cantidad += r.cantidad;
      bucket.set(r.tipoServicio, cur);
    }
    const periodos = Array.from(byPeriodo.keys()).sort().slice(-24);
    return periodos.map((p) => {
      const row: Record<string, string | number> = { label: shortLabel(p), periodo: p };
      for (const t of TIPO_SERVICIO_ORDER) {
        if (TIPO_HETEROGENEO.has(t)) continue;
        const agg = byPeriodo.get(p)?.get(t);
        if (agg && agg.cantidad > 0) row[t] = agg.monto / agg.cantidad;
      }
      return row;
    });
  }, [tipoMensual, adjust]);

  // Heatmap cliente × tipo — top 20 clientes por monto neto total.
  const clienteTipoHeatmap = useMemo(() => {
    const totalPorCuit = new Map<string, number>();
    const nombreDeCuit = new Map<string, string>();
    for (const r of clienteTipo) {
      totalPorCuit.set(r.cuit, (totalPorCuit.get(r.cuit) ?? 0) + r.montoNeto);
      nombreDeCuit.set(r.cuit, r.nombre);
    }
    const top20 = Array.from(totalPorCuit.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    const byCuit = new Map<string, Map<string, number>>();
    for (const r of clienteTipo) {
      if (!byCuit.has(r.cuit)) byCuit.set(r.cuit, new Map());
      byCuit.get(r.cuit)!.set(r.tipoServicio, r.montoNeto);
    }
    let min = Infinity;
    let max = -Infinity;
    const grid = top20.map(([cuit]) => {
      const map = byCuit.get(cuit) ?? new Map<string, number>();
      const cells: (number | null)[] = TIPO_SERVICIO_ORDER.map((t) => {
        const v = map.get(t);
        if (v && v > 0) {
          if (v < min) min = v;
          if (v > max) max = v;
          return v;
        }
        return null;
      });
      return { nombre: nombreDeCuit.get(cuit) ?? cuit, cells };
    });
    return {
      grid,
      min: min === Infinity ? 0 : min,
      max: max === -Infinity ? 0 : max,
    };
  }, [clienteTipo]);

  // Section 5: Check if tipo_entidad is actually populated
  const hasClassification = useMemo(() => {
    if (!data) return false;
    return data.clients.some(
      (c) => c.tipoEntidad !== "Sin clasificar" && c.tipoEntidad !== "",
    );
  }, [data]);

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
        <p className="mt-3 font-medium">Sin datos de servicios</p>
        <p className="text-sm text-muted-foreground">Ejecutá el ETL para importar facturas emitidas (PV 6).</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Ingresos — Servicios</h1>
          <p className="text-muted-foreground">Facturación, clientes y evolución — Servicios (Catering)</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSelector periodos={periodos} value={activePeriodo} onChange={setSelectedPeriodo} />
          <InflationToggle />
        </div>
      </div>

      {/* Info callout */}
      <ServiciosCallout
        collapsed={isInfoCollapsed}
        onToggle={() => setIsInfoCollapsed((v) => !v)}
      />

      {/* ====== SECTION 1: KPI Cards ====== */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturación Último Mes</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(last?.total ?? 0)}</div>
            {last && prev && (
              <p className={`text-xs ${(pctDelta(last.total, prev.total) ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPct(pctDelta(last.total, prev.total))} vs mes anterior
              </p>
            )}
            {last && prevYear && (
              <p className={`text-xs ${(pctDelta(last.total, prevYear.total) ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPct(pctDelta(last.total, prevYear.total))} vs mismo mes año anterior
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Servicios Último Mes</CardTitle>
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
            <CardTitle className="text-sm font-medium">Ticket Medio</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(lastTicket)}</div>
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
                  <TableHead className="text-right">Facturación ($)</TableHead>
                  <TableHead className="text-right w-[80px]">Δ%</TableHead>
                  <TableHead className="text-right">Cant. Servicios</TableHead>
                  <TableHead className="text-right w-[80px]">Δ%</TableHead>
                  <TableHead className="text-right">Ticket Medio</TableHead>
                  <TableHead className="text-right w-[80px]">Δ%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((row, idx) => {
                  const prevRow = idx < tableRows.length - 1 ? tableRows[idx + 1] : null;
                  const ticket = row.txCount > 0 ? row.total / row.txCount : 0;
                  const prevTicketVal = prevRow && prevRow.txCount > 0 ? prevRow.total / prevRow.txCount : 0;
                  const dFact = prevRow ? pctDelta(row.total, prevRow.total) : null;
                  const dTx = prevRow ? pctDelta(row.txCount, prevRow.txCount) : null;
                  const dTicket = prevTicketVal > 0 ? pctDelta(ticket, prevTicketVal) : null;
                  return (
                    <TableRow key={row.periodo}>
                      <TableCell className="sticky left-0 z-10 bg-card font-medium">{granularityLabel(row.periodo, granularity, ytdLastMonth, ytdCutoff)}</TableCell>
                      <TableCell className="text-right">{formatARS(row.total)}</TableCell>
                      <TableCell className={`text-right text-xs ${dFact !== null ? (dFact >= 0 ? "text-green-600" : "text-red-600") : ""}`}>
                        {formatPct(dFact)}
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
          <CardTitle className="text-base">Comparación Interanual de Facturación — Servicios</CardTitle>
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

      {/* ====== SECTION 3b: Year-over-Year Tx Count ====== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cantidad de Servicios por Mes</CardTitle>
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

      {/* ====== SECTION 4: Client Search + Evolution ====== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> Facturación por Cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <ClientCombobox
            clients={data.clients}
            value={selectedClient}
            onChange={setSelectedClient}
          />

          {selectedClient && selectedClientData && clientEvolution.length > 0 && (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={clientEvolution}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" fontSize={11} angle={-30} textAnchor="end" height={60} />
                  <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                  <Tooltip formatter={arsTooltip} />
                  <Bar dataKey="monto" name="Facturación" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-20 bg-card">Período</TableHead>
                      <TableHead className="text-right">Facturación</TableHead>
                      <TableHead className="text-right">Cant. Facturas</TableHead>
                      <TableHead className="text-right">% del mes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...clientEvolution].reverse().map((r) => {
                      const monthTotal = adjMonthly.find((m) => m.periodo === r.periodo)?.total ?? 0;
                      const pct = monthTotal > 0 ? (r.monto / monthTotal) * 100 : 0;
                      return (
                        <TableRow key={r.periodo}>
                          <TableCell className="sticky left-0 z-10 bg-card font-medium">{r.label}</TableCell>
                          <TableCell className="text-right">{formatARS(r.monto)}</TableCell>
                          <TableCell className="text-right">{r.txCount}</TableCell>
                          <TableCell className="text-right">{pct.toFixed(1)}%</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {selectedClient && clientEvolution.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Sin datos de facturación para este cliente
            </p>
          )}

          {/* Top 10 clients (always visible) — uses inflation-adjusted totals */}
          <div>
            <h3 className="text-sm font-medium mb-3">Top 10 Clientes (todo el historial)</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px] sticky left-0 z-20 bg-card">#</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Facturación</TableHead>
                    <TableHead className="text-right">% del Total</TableHead>
                    <TableHead className="text-right">Cant. Facturas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const allTimeTotal = adjustedClients.reduce((s, c) => s + c.monto, 0);
                    const rows = showAllClients ? adjustedClients : adjustedClients.slice(0, 10);
                    return rows.map((c, i) => (
                      <TableRow
                        key={c.cuit}
                        className={cn("cursor-pointer hover:bg-muted/50", selectedClient === c.cuit && "bg-muted")}
                        onClick={() => setSelectedClient(selectedClient === c.cuit ? "" : c.cuit)}
                      >
                        <TableCell className="sticky left-0 z-10 bg-card text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium max-w-[250px] truncate">{c.nombre}</TableCell>
                        <TableCell className="text-right">{formatARS(c.monto)}</TableCell>
                        <TableCell className="text-right">
                          {allTimeTotal > 0 ? ((c.monto / allTimeTotal) * 100).toFixed(1) : "0.0"}%
                        </TableCell>
                        <TableCell className="text-right">{c.cantFacturas}</TableCell>
                      </TableRow>
                    ));
                  })()}
                </TableBody>
              </Table>
            </div>
            {adjustedClients.length > 10 && !showAllClients && (
              <div className="text-center mt-3">
                <Button variant="ghost" size="sm" onClick={() => setShowAllClients(true)}>
                  Ver todos ({adjustedClients.length} clientes)
                </Button>
              </div>
            )}
            {showAllClients && adjustedClients.length > 10 && (
              <div className="text-center mt-3">
                <Button variant="ghost" size="sm" onClick={() => setShowAllClients(false)}>
                  Mostrar solo 10
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ====== SECTION 4b: Rotación de clientes (nuevos vs recurrentes) ====== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rotación de Clientes</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={rotacionData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="recurrentes" name="Recurrentes" stackId="a" fill="#3b82f6" />
              <Bar dataKey="nuevos" name="Nuevos" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            Cantidad de clientes que facturaron cada mes, separados en recurrentes (ya habían facturado antes) y nuevos (primera vez en toda la historia). Últimos 12 meses.
          </p>
        </CardContent>
      </Card>

      {/* ====== SECTION 4c: Concentración Pareto — curva ABC ====== */}
      {paretoData.length > 0 && (() => {
        // Find the rank where cumulative pct reaches 80%
        const rank80 = paretoData.find((p) => p.pct >= 80)?.rank ?? null;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Concentración de Facturación (Pareto)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={paretoData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="rank" fontSize={12} label={{ value: "Ranking de cliente", position: "insideBottom", offset: -5, fontSize: 11 }} />
                  <YAxis fontSize={12} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={((v: ValueType | undefined) => `${Number(v ?? 0).toFixed(1)}%`) as Formatter<ValueType, NameType>}
                    labelFormatter={(label) => {
                      const rank = Number(label);
                      const row = paretoData.find((p) => p.rank === rank);
                      return row ? `#${rank} — ${row.clientName}` : `#${rank}`;
                    }}
                  />
                  <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "80%", position: "right", fontSize: 11, fill: "#ef4444" }} />
                  <Line type="monotone" dataKey="pct" name="% acumulado" stroke="#3b82f6" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-2 text-xs text-muted-foreground">
                % acumulado de facturación por ranking de cliente (ajustado por inflación).
                {rank80 !== null && ` Los primeros ${rank80} clientes concentran el 80% de la facturación.`}
              </p>
            </CardContent>
          </Card>
        );
      })()}

      {/* ====== SECTION 4d: Heatmap cliente × mes ====== */}
      {clientHeatmap.grid.length > 0 && (() => {
        const { grid, months, min, max } = clientHeatmap;
        const cellBg = (val: number | null) => {
          if (val === null) return "bg-muted/30 text-muted-foreground";
          const range = max - min;
          if (range === 0) return "bg-blue-200";
          const t = (val - min) / range;
          if (t < 0.2) return "bg-blue-100 text-blue-900";
          if (t < 0.4) return "bg-blue-200 text-blue-900";
          if (t < 0.6) return "bg-blue-300 text-blue-900";
          if (t < 0.8) return "bg-blue-500 text-white";
          return "bg-blue-700 text-white";
        };
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 20 Clientes × Mes (últimos 12 meses)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left font-medium py-1.5 pr-3 sticky left-0 z-20 bg-card min-w-[180px]">Cliente</th>
                      {months.map((p) => (
                        <th key={p} className="text-center font-medium py-1.5 px-1 min-w-[60px]">{shortLabel(p)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((row) => (
                      <tr key={row.label}>
                        <td className="font-medium py-1 pr-3 sticky left-0 z-10 bg-card max-w-[220px] truncate">{row.label}</td>
                        {row.cells.map((val, i) => (
                          <td key={i} className={`text-center py-1.5 px-1 rounded ${cellBg(val)}`}>
                            {val !== null ? formatCompact(val) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span>Min: {formatCompact(min)}</span>
                <div className="flex h-3 w-40 overflow-hidden rounded border">
                  <div className="flex-1 bg-blue-100" />
                  <div className="flex-1 bg-blue-200" />
                  <div className="flex-1 bg-blue-300" />
                  <div className="flex-1 bg-blue-500" />
                  <div className="flex-1 bg-blue-700" />
                </div>
                <span>Max: {formatCompact(max)}</span>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ====== SECTION 4e: Histograma de frecuencia de facturación ====== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frecuencia de Facturación por Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={freqHistogram}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" fontSize={12} label={{ value: "Cant. de facturas en toda la historia", position: "insideBottom", offset: -5, fontSize: 11 }} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Clientes" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            Distribución de clientes según cantidad de facturas emitidas. Identifica clientes puntuales (1 factura) vs. recurrentes.
          </p>
        </CardContent>
      </Card>

      {/* ====== SECTION 4f: Público vs Privado en el tiempo ====== */}
      {hasClassification && pubPrivTimeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Público vs Privado — Evolución</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={pubPrivTimeline}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                <Line type="monotone" dataKey="publico" name="Público" stroke={PIE_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                <Line type="monotone" dataKey="privado" name="Privado" stroke={PIE_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Facturación mensual por tipo de entidad, últimos 24 meses. El sector público tiene estacionalidad propia (cierre presupuestario, licitaciones).
            </p>
          </CardContent>
        </Card>
      )}

      {/* ====== SECTION 4g: Desglose por Tipo de Servicio ====== */}
      <Card className="border-l-4 border-l-primary/60">
        <CardHeader>
          <CardTitle className="text-base">Desglose por Tipo de Servicio</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground space-y-1">
          <p>
            Cada renglón de factura se clasifica en una de 6 categorías <strong className="text-foreground">exclusivas</strong>: Viandas, Servicio de café, Catering, Mostrador, Convenio Marco, Otros.
          </p>
          <p>
            <strong className="text-foreground">Convenio Marco</strong> captura cualquier renglón cuya descripción contiene &ldquo;renglón&rdquo; y tiene prioridad sobre las demás categorías — típicamente son contratos recurrentes con ministerios. Si querés ver qué renglones se piden más, bajá a la sección &ldquo;Renglones más pedidos&rdquo;.
          </p>
          <p>
            Cantidades y precio promedio <strong className="text-foreground">se omiten</strong> para &ldquo;Convenio Marco&rdquo; y &ldquo;Otros&rdquo; porque mezclan productos con unidades distintas.
          </p>
        </CardContent>
      </Card>

      {/* Chart 1: Facturación por tipo (stacked area) */}
      {tipoAreaData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Facturación por Tipo de Servicio</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={460}>
              <AreaChart data={tipoAreaData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                {TIPO_SERVICIO_ORDER.map((t) => (
                  <Area
                    key={t}
                    type="monotone"
                    dataKey={t}
                    name={TIPO_SERVICIO_LABEL[t]}
                    stackId="1"
                    stroke={TIPO_SERVICIO_COLOR[t]}
                    fill={TIPO_SERVICIO_COLOR[t]}
                    fillOpacity={0.75}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Monto neto ajustado por inflación, asignado a cada renglón en proporción a su peso dentro de la factura. Últimos 24 meses.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Chart 2: cantidades por tipo (full width) */}
      {tipoCantidadData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cantidades por Tipo</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={420}>
              <LineChart data={tipoCantidadData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => Number(v).toLocaleString("es-AR")} />
                <Tooltip formatter={((v: ValueType | undefined) => Number(v ?? 0).toLocaleString("es-AR")) as Formatter<ValueType, NameType>} />
                <Legend />
                {TIPO_SERVICIO_ORDER.filter((t) => !TIPO_HETEROGENEO.has(t)).map((t) => (
                  <Line
                    key={t}
                    type="monotone"
                    dataKey={t}
                    name={TIPO_SERVICIO_LABEL[t]}
                    stroke={TIPO_SERVICIO_COLOR[t]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Unidades facturadas por mes. Distingue si un crecimiento viene de más volumen o de aumento de precio.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Chart 3: precio promedio por tipo (full width) */}
      {tipoPrecioData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Precio Promedio por Unidad</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={420}>
              <LineChart data={tipoPrecioData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => formatCompact(Number(v))} />
                <Tooltip formatter={arsTooltip} />
                <Legend />
                {TIPO_SERVICIO_ORDER.filter((t) => !TIPO_HETEROGENEO.has(t)).map((t) => (
                  <Line
                    key={t}
                    type="monotone"
                    dataKey={t}
                    name={TIPO_SERVICIO_LABEL[t]}
                    stroke={TIPO_SERVICIO_COLOR[t]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-muted-foreground">
              Precio neto por unidad ajustado por inflación (monto_neto / cantidad por tipo y mes). Si cae en términos reales, la rentabilidad está bajando.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Chart 4: heatmap cliente × tipo */}
      {clienteTipoHeatmap.grid.length > 0 && (() => {
        const { grid, min, max } = clienteTipoHeatmap;
        const cellBg = (val: number | null) => {
          if (val === null) return "bg-muted/30 text-muted-foreground";
          const range = max - min;
          if (range === 0) return "bg-indigo-300";
          const t = (val - min) / range;
          if (t < 0.2) return "bg-indigo-100 text-indigo-900";
          if (t < 0.4) return "bg-indigo-200 text-indigo-900";
          if (t < 0.6) return "bg-indigo-300 text-indigo-900";
          if (t < 0.8) return "bg-indigo-500 text-white";
          return "bg-indigo-700 text-white";
        };
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 20 Clientes × Tipo de Servicio</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left font-medium py-2 pr-3 sticky left-0 z-20 bg-card min-w-[240px]">Cliente</th>
                      {TIPO_SERVICIO_ORDER.map((t) => (
                        <th key={t} className="text-center font-medium py-2 px-2 min-w-[120px]">{TIPO_SERVICIO_LABEL[t]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((row, i) => (
                      <tr key={`${row.nombre}-${i}`}>
                        <td className="font-medium py-1 pr-3 sticky left-0 z-10 bg-card max-w-[220px] truncate">{row.nombre}</td>
                        {row.cells.map((val, j) => (
                          <td key={j} className={`text-center py-1.5 px-1 rounded ${cellBg(val)}`}>
                            {val !== null ? formatCompact(val) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>Valores nominales (all-time sumado)</span>
                <div className="flex items-center gap-2">
                  <span>Min: {formatCompact(min)}</span>
                  <div className="flex h-3 w-40 overflow-hidden rounded border">
                    <div className="flex-1 bg-indigo-100" />
                    <div className="flex-1 bg-indigo-200" />
                    <div className="flex-1 bg-indigo-300" />
                    <div className="flex-1 bg-indigo-500" />
                    <div className="flex-1 bg-indigo-700" />
                  </div>
                  <span>Max: {formatCompact(max)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* ====== Renglones más pedidos — agrupados por número de renglón ====== */}
      {topRenglones.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Renglones más pedidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px] sticky left-0 z-20 bg-card">Renglón</TableHead>
                    <TableHead>Ejemplo de descripción</TableHead>
                    <TableHead className="text-right">Cantidad total</TableHead>
                    <TableHead className="text-right">Líneas</TableHead>
                    <TableHead className="text-right">Monto (neto)</TableHead>
                    <TableHead className="text-right">Clientes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topRenglones.map((r) => (
                    <TableRow key={r.numero}>
                      <TableCell className="sticky left-0 z-10 bg-card font-semibold">#{r.numero}</TableCell>
                      <TableCell className="max-w-[480px] truncate text-muted-foreground" title={r.ejemplo}>{r.ejemplo}</TableCell>
                      <TableCell className="text-right">{Math.round(r.cantidad).toLocaleString("es-AR")}</TableCell>
                      <TableCell className="text-right">{r.lineas.toLocaleString("es-AR")}</TableCell>
                      <TableCell className="text-right font-medium">{formatARS(r.montoNeto)}</TableCell>
                      <TableCell className="text-right">{r.clientes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Agrupado por <strong>número de renglón</strong> extraído de la descripción (ej: &ldquo;Renglón 15: racionamiento; desayuno...&rdquo; y &ldquo;Renglón 15&rdquo; se suman como uno solo). Valores nominales all-time. Ordenado por monto facturado.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ====== SECTION 5: Público/Privado + Clasificación side by side ====== */}
      <div className="grid gap-4 lg:grid-cols-2">
        {hasClassification ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Distribución Público vs Privado</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Público", value: adjMonthly.reduce((s, r) => s + r.publico, 0) },
                      { name: "Privado", value: adjMonthly.reduce((s, r) => s + r.privado, 0) },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {PIE_COLORS.map((color, i) => (
                      <Cell key={i} fill={color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={arsTooltip} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-6 mt-2 text-sm">
                <div className="text-center">
                  <span className="text-muted-foreground">Público</span>
                  <p className="font-bold">{data.kpis.pctPublico.toFixed(1)}%</p>
                </div>
                <div className="text-center">
                  <span className="text-muted-foreground">Privado</span>
                  <p className="font-bold">{(100 - data.kpis.pctPublico).toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Clasificación de clientes pendiente de configurar.
                Agregá el campo <code>tipo_entidad</code> a los clientes para ver la distribución público/privado.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Por Segmento (campo clasificacion — tipo de actividad, independiente de público/privado) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por Segmento</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const CLASIF_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];
              const byClasif = new Map<string, number>();
              for (const c of adjustedClients) {
                const key = c.clasificacion || "Sin clasificar";
                byClasif.set(key, (byClasif.get(key) ?? 0) + c.monto);
              }
              const clasifData = Array.from(byClasif.entries())
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 8);
              const clasifTotal = clasifData.reduce((s, d) => s + d.value, 0);

              if (clasifData.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-8">Sin datos de clasificación</p>;
              }

              return (
                <>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={clasifData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        label={({ name, percent }) => `${String(name).slice(0, 12)} ${((percent ?? 0) * 100).toFixed(0)}%`}
                        labelLine={false}
                        fontSize={10}
                      >
                        {clasifData.map((_, i) => (
                          <Cell key={i} fill={CLASIF_COLORS[i % CLASIF_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={arsTooltip} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2 text-xs">
                    {clasifData.map((d, i) => (
                      <span key={d.name} className="flex items-center gap-1">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CLASIF_COLORS[i % CLASIF_COLORS.length] }} />
                        {d.name} {clasifTotal > 0 ? ((d.value / clasifTotal) * 100).toFixed(0) : 0}%
                      </span>
                    ))}
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

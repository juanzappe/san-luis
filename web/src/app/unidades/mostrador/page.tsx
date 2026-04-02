"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, Store, ShoppingBag, Hash, Search, ChevronsUpDown } from "lucide-react";
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
import {
  type MostradorMonthly, type MostradorRankingRow, type ProductoSemanalRow,
  type HeatmapCell,
  fetchMostradorMensual, fetchMostradorHeatmap, fetchProductosLista,
  fetchProductoSemanal, fetchRankingMensual,
  formatARS, dayName, hourLabel, periodoLabel,
} from "@/lib/units-queries";
import { pctDelta, formatPct } from "@/lib/economic-queries";
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
type Granularity = "mensual" | "trimestral" | "anual";

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
}

function aggregateMonthly(data: AggRow[], g: Granularity): AggRow[] {
  if (g === "mensual") return data;
  const buckets = new Map<string, AggRow>();
  for (const r of data) {
    const [y, m] = r.periodo.split("-");
    const key = g === "trimestral" ? `${y}-${QUARTER_MAP[m]}` : y;
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, { ...r, periodo: key });
    } else {
      cur.monto += r.monto;
      cur.cantidad += r.cantidad;
      cur.txCount += r.txCount;
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
// Heatmap component (unchanged)
// ---------------------------------------------------------------------------
function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  const maxMonto = useMemo(() => Math.max(...cells.map((c) => c.monto), 1), [cells]);
  const days = [1, 2, 3, 4, 5, 6, 0];
  const hours = Array.from({ length: 15 }, (_, i) => i + 8);

  const cellMap = useMemo(() => {
    const m = new Map<string, HeatmapCell>();
    for (const c of cells) m.set(`${c.day}|${c.hour}`, c);
    return m;
  }, [cells]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="px-1 py-1 text-left" />
            {hours.map((h) => (
              <th key={h} className="px-1 py-1 text-center">{hourLabel(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d}>
              <td className="px-1 py-1 font-medium">{dayName(d)}</td>
              {hours.map((h) => {
                const cell = cellMap.get(`${d}|${h}`);
                const intensity = cell ? cell.monto / maxMonto : 0;
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
                      title={cell ? `${formatARS(cell.monto)} (${cell.count} ventas)` : "Sin datos"}
                    >
                      {cell ? cell.count : ""}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

  // Section 5: Product search
  const [selectedProduct, setSelectedProduct] = useState("");
  const [weeklyData, setWeeklyData] = useState<ProductoSemanalRow[]>([]);
  const [weeklyLoading, setWeeklyLoading] = useState(false);

  // Section 6: Product ranking
  const [rankingMonth, setRankingMonth] = useState("");
  const [ranking, setRanking] = useState<MostradorRankingRow[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [showAllRanking, setShowAllRanking] = useState(false);

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

  // Aggregated data for table (Section 2)
  const aggregated = useMemo(() => aggregateMonthly(adjMonthly, granularity), [adjMonthly, granularity]);
  const tableRows = useMemo(() => [...aggregated].reverse(), [aggregated]);

  // KPI data (Section 1)
  const last = adjMonthly.length > 0 ? adjMonthly[adjMonthly.length - 1] : null;
  const prev = adjMonthly.length > 1 ? adjMonthly[adjMonthly.length - 2] : null;
  const lastTicket = last && last.txCount > 0 ? last.monto / last.txCount : 0;
  const prevTicket = prev && prev.txCount > 0 ? prev.monto / prev.txCount : 0;

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
          <h1 className="text-3xl font-bold tracking-tight">Mostrador</h1>
          <p className="text-muted-foreground">Ventas POS — productos, tendencias y horarios</p>
        </div>
        <InflationToggle />
      </div>

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
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ticket Promedio</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(lastTicket)}</div>
            {prevTicket > 0 && (
              <p className={`text-xs ${(pctDelta(lastTicket, prevTicket) ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPct(pctDelta(lastTicket, prevTicket))} vs mes anterior
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
            {(["mensual", "trimestral", "anual"] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`px-3 py-1.5 capitalize transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  granularity === g ? "bg-primary text-primary-foreground" : "hover:bg-accent"
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
                  <TableHead className="w-[160px]">Período</TableHead>
                  <TableHead className="text-right">Ventas ($)</TableHead>
                  <TableHead className="text-right w-[80px]">Δ%</TableHead>
                  <TableHead className="text-right">Transacciones</TableHead>
                  <TableHead className="text-right w-[80px]">Δ%</TableHead>
                  <TableHead className="text-right">Ticket Promedio</TableHead>
                  <TableHead className="text-right w-[80px]">Δ%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((row, idx) => {
                  const prevRow = idx < tableRows.length - 1 ? tableRows[idx + 1] : null;
                  const ticket = row.txCount > 0 ? row.monto / row.txCount : 0;
                  const prevTicketVal = prevRow && prevRow.txCount > 0 ? prevRow.monto / prevRow.txCount : 0;
                  const dVentas = prevRow ? pctDelta(row.monto, prevRow.monto) : null;
                  const dTx = prevRow ? pctDelta(row.txCount, prevRow.txCount) : null;
                  const dTicket = prevTicketVal > 0 ? pctDelta(ticket, prevTicketVal) : null;
                  return (
                    <TableRow key={row.periodo}>
                      <TableCell className="font-medium">{granularityLabel(row.periodo, granularity)}</TableCell>
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
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ====== SECTION 4: Heatmap ====== */}
      <Card>
        <CardHeader><CardTitle className="text-base">Mapa de Calor — Día × Hora</CardTitle></CardHeader>
        <CardContent>
          {heatmap.length > 0 ? (
            <Heatmap cells={heatmap} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Sin datos horarios disponibles</p>
          )}
        </CardContent>
      </Card>

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

          {!weeklyLoading && selectedProduct && weeklyData.length > 0 && (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={weeklyData.map((w) => ({
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
                      <TableHead>Semana</TableHead>
                      <TableHead className="text-right">Cantidad</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="text-right">Promedio diario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyData.map((w) => (
                      <TableRow key={w.semana}>
                        <TableCell className="font-medium">
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

          {!weeklyLoading && selectedProduct && weeklyData.length === 0 && (
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
                      <TableHead className="w-[50px]">#</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right">Promedio diario</TableHead>
                      <TableHead className="text-right">Total mes</TableHead>
                      <TableHead className="text-right">Unidad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(showAllRanking ? ranking : ranking.slice(0, 20)).map((r, i) => (
                      <TableRow key={r.producto}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium max-w-[250px] truncate">{r.producto}</TableCell>
                        <TableCell className="text-right">{r.promedioDiario.toLocaleString("es-AR", { maximumFractionDigits: 1 })}</TableCell>
                        <TableCell className="text-right">{r.totalCantidad.toLocaleString("es-AR", { maximumFractionDigits: 1 })}</TableCell>
                        <TableCell className="text-right text-muted-foreground">unidades</TableCell>
                      </TableRow>
                    ))}
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

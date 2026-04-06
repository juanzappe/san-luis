"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, Briefcase, ShoppingBag, Hash, Search, ChevronsUpDown } from "lucide-react";

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
  type ServiciosData, type ServiciosClientRow, fetchServicios,
  formatARS, periodoLabel,
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

const YEAR_COLORS = ["#94a3b8", "#22c55e", "#3b82f6", "#f59e0b", "#ef4444"];
const PIE_COLORS = ["#3b82f6", "#22c55e"];

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

  useEffect(() => {
    fetchServicios()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
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

  // Aggregated for table (Section 2)
  const aggregated = useMemo(() => aggregateMonthly(adjMonthly, granularity, ytdLastMonth), [adjMonthly, granularity, ytdLastMonth]);
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

  // Total for last 12 months (for top 10 % calculation)
  const last12Total = useMemo(() => {
    const periods = adjMonthly.slice(-12);
    return periods.reduce((s, r) => s + r.total, 0);
  }, [adjMonthly]);

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
                  <TableHead className="w-[160px]">Período</TableHead>
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
                      <TableCell className="font-medium">{granularityLabel(row.periodo, granularity, ytdLastMonth)}</TableCell>
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
                  connectNulls
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
                  connectNulls
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
                      <TableHead>Período</TableHead>
                      <TableHead className="text-right">Facturación</TableHead>
                      <TableHead className="text-right">Cant. Facturas</TableHead>
                      <TableHead className="text-right">% del Total Servicios</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...clientEvolution].reverse().map((r) => {
                      const monthTotal = adjMonthly.find((m) => m.periodo === r.periodo)?.total ?? 0;
                      const pct = monthTotal > 0 ? (r.monto / monthTotal) * 100 : 0;
                      return (
                        <TableRow key={r.periodo}>
                          <TableCell className="font-medium">{r.label}</TableCell>
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

          {/* Top 10 clients (always visible) */}
          <div>
            <h3 className="text-sm font-medium mb-3">Top 10 Clientes (últimos 12 meses)</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">#</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Facturación</TableHead>
                    <TableHead className="text-right">% del Total</TableHead>
                    <TableHead className="text-right">Cant. Facturas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(showAllClients ? data.clients : data.clients.slice(0, 10)).map((c, i) => (
                    <TableRow
                      key={c.cuit}
                      className={cn("cursor-pointer hover:bg-muted/50", selectedClient === c.cuit && "bg-muted")}
                      onClick={() => setSelectedClient(selectedClient === c.cuit ? "" : c.cuit)}
                    >
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium max-w-[250px] truncate">{c.nombre}</TableCell>
                      <TableCell className="text-right">{formatARS(c.monto)}</TableCell>
                      <TableCell className="text-right">
                        {last12Total > 0 ? ((c.monto / last12Total) * 100).toFixed(1) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right">{c.cantFacturas}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data.clients.length > 10 && !showAllClients && (
              <div className="text-center mt-3">
                <Button variant="ghost" size="sm" onClick={() => setShowAllClients(true)}>
                  Ver todos ({data.clients.length} clientes)
                </Button>
              </div>
            )}
            {showAllClients && data.clients.length > 10 && (
              <div className="text-center mt-3">
                <Button variant="ghost" size="sm" onClick={() => setShowAllClients(false)}>
                  Mostrar solo 10
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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

        {/* Por Clasificación */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por Clasificación</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const CLASIF_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#8b5cf6", "#ef4444", "#ec4899", "#06b6d4", "#84cc16"];
              const byClasif = new Map<string, number>();
              for (const c of data.clients) {
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

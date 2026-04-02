"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, Coffee, ShoppingBag, Hash } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type RestobarData, type HeatmapCell, fetchRestobar,
  formatARS, periodoLabel, dayName, hourLabel,
} from "@/lib/units-queries";
import { pctDelta, formatPct } from "@/lib/economic-queries";
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
// Heatmap component
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
                          ? `rgba(6, 182, 212, ${0.1 + intensity * 0.85})`
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
// Main
// ---------------------------------------------------------------------------
export default function RestobarPage() {
  const [data, setData] = useState<RestobarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();
  const [granularity, setGranularity] = useState<Granularity>("mensual");

  useEffect(() => {
    fetchRestobar()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Inflation-adjusted monthly data
  const adjMonthly = useMemo(
    () => (data?.monthly ?? []).map((r) => ({
      ...r,
      monto: adjust(r.monto, r.periodo),
    })),
    [data, adjust],
  );

  // Aggregated for table (Section 2)
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
          <h1 className="text-3xl font-bold tracking-tight">Restobar</h1>
          <p className="text-muted-foreground">Ventas, ticket promedio y horarios pico</p>
        </div>
        <InflationToggle />
      </div>

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
          {data.heatmap.length > 0 ? (
            <Heatmap cells={data.heatmap} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Sin datos horarios disponibles</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

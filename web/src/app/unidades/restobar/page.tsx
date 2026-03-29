"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Loader2, AlertCircle, Coffee, Receipt, Calendar, Hash } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { InflationToggle, useInflation } from "@/lib/inflation";
import {
  type RestobarData, type HeatmapCell, fetchRestobar,
  formatARS, periodoLabel, shortLabel, dayName, hourLabel,
} from "@/lib/units-queries";
import type {
  Formatter, ValueType, NameType,
} from "recharts/types/component/DefaultTooltipContent";

const arsTooltip: Formatter<ValueType, NameType> = (v) => formatARS(Number(v ?? 0));

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

export default function RestobarPage() {
  const [data, setData] = useState<RestobarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { adjust } = useInflation();

  useEffect(() => {
    fetchRestobar()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

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

  const monthRows = data.monthly.map((r) => ({
    ...r,
    montoAdj: adjust(r.monto, r.periodo),
    ticket: r.txCount > 0 ? adjust(r.monto, r.periodo) / r.txCount : 0,
    label: shortLabel(r.periodo),
  }));

  const last = monthRows[monthRows.length - 1];
  const prev = monthRows.length > 1 ? monthRows[monthRows.length - 2] : null;
  const lastDelta = last && prev ? ((last.montoAdj - prev.montoAdj) / Math.abs(prev.montoAdj || 1)) * 100 : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Restobar</h1>
          <p className="text-muted-foreground">Ventas, ticket promedio y horarios pico</p>
        </div>
        <InflationToggle />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ventas Último Mes</CardTitle>
            <Coffee className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(last?.montoAdj ?? 0)}</div>
            {lastDelta !== null && (
              <p className={`text-xs ${lastDelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                {lastDelta >= 0 ? "+" : ""}{lastDelta.toFixed(1)}% vs mes anterior
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ticket Promedio</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatARS(data.kpis.ticketPromedio)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Mejor Mes</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{data.kpis.mesTop}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Transacciones</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.kpis.txTotal.toLocaleString("es-AR")}</div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly bar + ticket line */}
      <Card>
        <CardHeader><CardTitle className="text-base">Evolución Mensual</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={monthRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${(v / 1e3).toFixed(0)}K`} />
              <Tooltip formatter={arsTooltip} />
              <Legend />
              <Bar yAxisId="left" dataKey="montoAdj" name="Ventas" fill="#06b6d4" />
              <Line yAxisId="right" type="monotone" dataKey="ticket" name="Ticket Prom." stroke="#f59e0b" strokeWidth={2} dot={false} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Transactions line */}
      <Card>
        <CardHeader><CardTitle className="text-base">Transacciones Mensuales</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={monthRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="txCount" name="Transacciones" stroke="#06b6d4" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Heatmap */}
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

      {/* Monthly detail table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Detalle Mensual</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                  <TableHead className="text-right">Transacciones</TableHead>
                  <TableHead className="text-right">Ticket Prom.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthRows.map((r) => (
                  <TableRow key={r.periodo}>
                    <TableCell className="font-medium">{periodoLabel(r.periodo)}</TableCell>
                    <TableCell className="text-right">{formatARS(r.montoAdj)}</TableCell>
                    <TableCell className="text-right">{r.txCount.toLocaleString("es-AR")}</TableCell>
                    <TableCell className="text-right">{formatARS(r.ticket)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

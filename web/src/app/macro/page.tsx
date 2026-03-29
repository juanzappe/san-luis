"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type {
  ValueType,
  NameType,
  Formatter,
} from "recharts/types/component/DefaultTooltipContent";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Percent,
  Landmark,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type MacroKpis,
  type MacroTableRow,
  type InflacionAnual,
  fetchMacroKpis,
  fetchIpcMensual24,
  fetchDolarEvolucion,
  fetchTasaVsInflacion,
  fetchInflacionAnual,
  fetchMacroTable,
} from "@/lib/macro-queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  return v.toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + "%";
}

function fmtARS(v: number | null): string {
  if (v == null) return "—";
  return "$ " + v.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtNum(v: number | null, decimals = 2): string {
  if (v == null) return "—";
  return v.toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(fecha: string | null): string {
  if (!fecha) return "";
  const [y, m, d] = fecha.split("-");
  return `${d}/${m}/${y}`;
}

function fmtPeriodo(p: string): string {
  const [y, m] = p.split("-");
  const meses = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];
  return `${meses[parseInt(m) - 1]} ${y}`;
}

const tooltipFmt: Formatter<ValueType, NameType> = (v) =>
  typeof v === "number" ? fmtNum(v) : String(v);

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

function KpiCard({
  title,
  value,
  subtitle,
  delta,
  deltaLabel,
  icon: Icon,
  iconColor,
}: {
  title: string;
  value: string;
  subtitle?: string;
  delta?: number | null;
  deltaLabel?: string;
  icon: React.ElementType;
  iconColor: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
        {delta != null && (
          <p className={`text-xs mt-1 flex items-center gap-1 ${delta >= 0 ? "text-red-600" : "text-green-600"}`}>
            {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta >= 0 ? "+" : ""}{fmtNum(delta)} {deltaLabel ?? ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sync button
// ---------------------------------------------------------------------------

interface SyncResult {
  ipc: { ok: boolean; count: number; error?: string };
  dolar_oficial: { ok: boolean; count: number; error?: string };
  dolar_blue: { ok: boolean; count: number; error?: string };
  tasa: { ok: boolean; count: number; error?: string };
}

function SyncButton({ onSynced }: { onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/macro/sync", { method: "POST" });
      const data: SyncResult = await res.json();
      setResult(data);
      onSynced();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error de conexión");
    } finally {
      setSyncing(false);
    }
  }, [onSynced]);

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Actualizando…" : "Actualizar datos"}
      </button>
      {result && (
        <div className="flex items-center gap-2 text-xs">
          {Object.entries(result).map(([key, val]) => (
            <span key={key} className={`flex items-center gap-0.5 ${val.ok ? "text-green-600" : "text-red-500"}`}>
              {val.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {key === "dolar_oficial" ? "USD Of" : key === "dolar_blue" ? "USD Blue" : key.toUpperCase()}
            </span>
          ))}
        </div>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IndicadoresMacroPage() {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<MacroKpis | null>(null);
  const [ipcChart, setIpcChart] = useState<{ periodo: string; valor: number }[]>([]);
  const [dolarChart, setDolarChart] = useState<{ periodo: string; oficial: number | null; blue: number | null }[]>([]);
  const [tasaChart, setTasaChart] = useState<{ periodo: string; tasa: number | null; inflacion: number | null }[]>([]);
  const [anualChart, setAnualChart] = useState<InflacionAnual[]>([]);
  const [tableData, setTableData] = useState<MacroTableRow[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [k, ipc, dolar, tasa, anual, table] = await Promise.all([
      fetchMacroKpis(),
      fetchIpcMensual24(),
      fetchDolarEvolucion(),
      fetchTasaVsInflacion(),
      fetchInflacionAnual(),
      fetchMacroTable(),
    ]);
    setKpis(k);
    setIpcChart(ipc);
    setDolarChart(dolar);
    setTasaChart(tasa);
    setAnualChart(anual);
    setTableData(table);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Cargando indicadores…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Indicadores Macro</h1>
          <p className="text-muted-foreground">
            IPC, tipo de cambio y tasa de interés — Argentina
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://rendimientos.co/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-gray-50 hover:text-foreground"
          >
            Ver en Rendimientos AR
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <SyncButton onSynced={loadData} />
        </div>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            title="Inflación mensual"
            value={fmtPct(kpis.inflacionMensual)}
            subtitle={
              kpis.inflacionInteranual != null
                ? `Interanual: ${fmtPct(kpis.inflacionInteranual)}`
                : undefined
            }
            delta={kpis.inflacionDelta}
            deltaLabel="pp vs mes ant."
            icon={Percent}
            iconColor="text-orange-500"
          />
          <KpiCard
            title="Dólar Oficial"
            value={fmtARS(kpis.dolarOficial)}
            subtitle={kpis.dolarOficialFecha ? `Al ${fmtDate(kpis.dolarOficialFecha)}` : undefined}
            delta={kpis.dolarOficialDelta}
            deltaLabel="vs anterior"
            icon={DollarSign}
            iconColor="text-green-600"
          />
          <KpiCard
            title="Dólar Blue"
            value={fmtARS(kpis.dolarBlue)}
            subtitle={
              kpis.dolarBlue && kpis.dolarOficial
                ? `Brecha: ${fmtPct(((kpis.dolarBlue - kpis.dolarOficial) / kpis.dolarOficial) * 100)}`
                : kpis.dolarBlueFecha
                  ? `Al ${fmtDate(kpis.dolarBlueFecha)}`
                  : undefined
            }
            delta={kpis.dolarBlueDelta}
            deltaLabel="vs anterior"
            icon={DollarSign}
            iconColor="text-blue-600"
          />
          <KpiCard
            title="Tasa depósitos 30d"
            value={kpis.tasa != null ? `${fmtNum(kpis.tasa)}% TNA` : "—"}
            subtitle={kpis.tasaFecha ? `Al ${fmtDate(kpis.tasaFecha)}` : undefined}
            delta={kpis.tasaDelta}
            deltaLabel="pp vs anterior"
            icon={Landmark}
            iconColor="text-purple-600"
          />
        </div>
      )}

      {/* Charts row 1: IPC mensual + Dólar evolución */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* IPC mensual */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inflación mensual — últimos 24 meses</CardTitle>
          </CardHeader>
          <CardContent>
            {ipcChart.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de IPC. Presioná &quot;Actualizar datos&quot;.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={ipcChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="periodo" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: number) => [`${fmtNum(v)}%`, "Inflación"]} labelFormatter={fmtPeriodo} />
                  <Bar dataKey="valor" fill="#f97316" name="Inflación %" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Dólar evolución */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dólar oficial vs blue — últimos 12 meses</CardTitle>
          </CardHeader>
          <CardContent>
            {dolarChart.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sin datos. Presioná &quot;Actualizar datos&quot;.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dolarChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="periodo" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={tooltipFmt} labelFormatter={fmtPeriodo} />
                  <Legend />
                  <Line type="monotone" dataKey="oficial" stroke="#22c55e" name="Oficial" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="blue" stroke="#3b82f6" name="Blue" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2: Tasa vs inflación + Inflación anual */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* Tasa vs inflación */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tasa de interés vs inflación</CardTitle>
          </CardHeader>
          <CardContent>
            {tasaChart.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sin datos.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={tasaChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="periodo" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      `${fmtNum(v)}%`,
                      name === "tasa" ? "Tasa TNA" : "Inflación mensual",
                    ]}
                    labelFormatter={fmtPeriodo}
                  />
                  <Legend formatter={(v) => (v === "tasa" ? "Tasa TNA" : "Inflación mensual")} />
                  <Line type="monotone" dataKey="tasa" stroke="#8b5cf6" name="tasa" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="inflacion" stroke="#f97316" name="inflacion" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Inflación acumulada por año */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inflación acumulada por año</CardTitle>
          </CardHeader>
          <CardContent>
            {anualChart.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sin datos.</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={anualChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="anio" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v)}%`} />
                  <Tooltip formatter={(v: number) => [`${fmtNum(v, 1)}%`, "Acumulada"]} />
                  <Bar dataKey="acumulada" fill="#ef4444" name="Inflación anual %" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tabla resumen — últimos 24 meses</CardTitle>
        </CardHeader>
        <CardContent>
          {tableData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sin datos. Presioná &quot;Actualizar datos&quot; para cargar desde las APIs.</p>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 bg-white">Período</TableHead>
                    <TableHead className="sticky top-0 bg-white text-right">IPC %</TableHead>
                    <TableHead className="sticky top-0 bg-white text-right">IPC Acum.</TableHead>
                    <TableHead className="sticky top-0 bg-white text-right">Dólar Of.</TableHead>
                    <TableHead className="sticky top-0 bg-white text-right">Dólar Blue</TableHead>
                    <TableHead className="sticky top-0 bg-white text-right">Brecha %</TableHead>
                    <TableHead className="sticky top-0 bg-white text-right">Tasa %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...tableData].reverse().map((row) => (
                    <TableRow key={row.periodo}>
                      <TableCell className="font-medium">{fmtPeriodo(row.periodo)}</TableCell>
                      <TableCell className="text-right">{fmtPct(row.ipcMensual)}</TableCell>
                      <TableCell className="text-right">{fmtPct(row.ipcAcumulado)}</TableCell>
                      <TableCell className="text-right">{row.dolarOficial != null ? fmtARS(row.dolarOficial) : "—"}</TableCell>
                      <TableCell className="text-right">{row.dolarBlue != null ? fmtARS(row.dolarBlue) : "—"}</TableCell>
                      <TableCell className="text-right">{fmtPct(row.brecha)}</TableCell>
                      <TableCell className="text-right">{row.tasa != null ? fmtPct(row.tasa) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

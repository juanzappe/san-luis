"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  type VencimientoRow,
  fetchVencimientos,
  vencimientoColor,
  jurisdiccionColor,
  formatARS,
} from "@/lib/tax-queries";

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DOW_HEADERS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function calendarDays(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  // Monday = 0 offset
  let startDow = first.getDay() - 1;
  if (startDow < 0) startDow = 6;
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay; d++) cells.push(d);
  // Pad to fill last week
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

type ViewMode = "calendar" | "list";

export default function CalendarioPage() {
  const [data, setData] = useState<VencimientoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("calendar");

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());

  useEffect(() => {
    fetchVencimientos()
      .then(setData)
      .catch((e) => setError(e.message ?? "Error"))
      .finally(() => setLoading(false));
  }, []);

  // Group by date for calendar
  const byDate = useMemo(() => {
    const map = new Map<string, VencimientoRow[]>();
    for (const v of data) {
      if (!map.has(v.fecha)) map.set(v.fecha, []);
      map.get(v.fecha)!.push(v);
    }
    return map;
  }, [data]);

  // Calendar cells
  const cells = useMemo(() => calendarDays(calYear, calMonth), [calYear, calMonth]);

  // Upcoming list (future + recently vencido)
  const upcoming = useMemo(() => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoff = threeMonthsAgo.toISOString().slice(0, 10);
    return data.filter((v) => v.fecha >= cutoff).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }, [data]);

  function prevMonth() {
    if (calMonth === 0) { setCalYear(calYear - 1); setCalMonth(11); }
    else setCalMonth(calMonth - 1);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(calYear + 1); setCalMonth(0); }
    else setCalMonth(calMonth + 1);
  }

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
  if (data.length === 0) {
    return (
      <Card><CardContent className="py-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Sin vencimientos cargados</p>
        <p className="text-sm text-muted-foreground">Importá obligaciones fiscales para ver el calendario.</p>
      </CardContent></Card>
    );
  }

  // Stats
  const today = new Date().toISOString().slice(0, 10);
  const pendientes = data.filter((v) => v.estado !== "pagado" && v.fecha >= today).length;
  const vencidos = data.filter((v) => v.estado !== "pagado" && v.fecha < today).length;
  const proximos7d = data.filter((v) => {
    if (v.estado === "pagado") return false;
    const diff = (new Date(v.fecha).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Calendario de Vencimientos</h1>
          <p className="text-muted-foreground">Obligaciones fiscales por fecha</p>
        </div>
        <div className="flex gap-1">
          {(["calendar", "list"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setView(m)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                view === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {m === "calendar" ? "Calendario" : "Lista"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex flex-wrap gap-3">
        <span className="rounded bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
          {proximos7d} vencen en 7 días
        </span>
        <span className="rounded bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
          {vencidos} vencidos sin pagar
        </span>
        <span className="rounded bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
          {pendientes} pendientes
        </span>
        <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500" /> ARCA</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> ARBA</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" /> Municipal</span>
        </div>
      </div>

      {view === "calendar" ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <button onClick={prevMonth} className="rounded p-1 hover:bg-muted">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <CardTitle className="text-base">{MONTH_NAMES[calMonth]} {calYear}</CardTitle>
            <button onClick={nextMonth} className="rounded p-1 hover:bg-muted">
              <ChevronRight className="h-5 w-5" />
            </button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-px">
              {/* Header */}
              {DOW_HEADERS.map((d) => (
                <div key={d} className="p-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
              ))}
              {/* Days */}
              {cells.map((day, i) => {
                if (day === null) return <div key={`e-${i}`} className="min-h-[80px] bg-muted/30 rounded" />;
                const dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const vtos = byDate.get(dateStr) ?? [];
                const isToday = dateStr === today;
                return (
                  <div key={dateStr} className={`min-h-[80px] rounded border p-1 ${isToday ? "border-primary bg-primary/5" : "border-transparent"}`}>
                    <div className={`text-xs font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>{day}</div>
                    <div className="mt-1 space-y-0.5">
                      {vtos.map((v) => {
                        const color = vencimientoColor(v.fecha, v.estado);
                        return (
                          <div key={v.id} className={`flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight ${color.bg} ${color.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${jurisdiccionColor(v.jurisdiccion)}`} />
                            <span className="truncate">{v.tipoLabel}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        /* List view */
        <Card>
          <CardHeader><CardTitle className="text-base">Próximos Vencimientos</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Impuesto</TableHead>
                    <TableHead>Jurisdicción</TableHead>
                    <TableHead>Período Fiscal</TableHead>
                    <TableHead className="text-right">Monto Estimado</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcoming.map((v) => {
                    const color = vencimientoColor(v.fecha, v.estado);
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="whitespace-nowrap font-medium">{v.fecha}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${jurisdiccionColor(v.jurisdiccion)}`} />
                            {v.tipoLabel}
                          </div>
                        </TableCell>
                        <TableCell>{v.jurisdiccionLabel}</TableCell>
                        <TableCell>{v.periodoFiscal}</TableCell>
                        <TableCell className="text-right">{v.montoEstimado ? formatARS(v.montoEstimado) : "—"}</TableCell>
                        <TableCell>
                          <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color.bg} ${color.text}`}>
                            {color.label}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

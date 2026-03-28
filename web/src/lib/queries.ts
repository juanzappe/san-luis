/**
 * Queries para el dashboard Home — Resumen Ejecutivo.
 * Usa el cliente Supabase (REST) del lado del cliente.
 */
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface MonthRow {
  periodo: string; // YYYY-MM
  ingresos: number;
  egresos: number;
  sueldos: number;
  resultado: number;
  margen: number; // %
}

export interface KpiData {
  ingresos: number;
  egresos: number;
  sueldos: number;
  resultado: number;
  deltaIngresos: number | null;
  deltaEgresos: number | null;
  deltaSueldos: number | null;
  deltaResultado: number | null;
  periodo: string; // "Marzo 2026"
}

export interface IncomeBySource {
  periodo: string;
  mostrador: number;
  servicios: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodoLabel(p: string): string {
  const [y, m] = p.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Agrupa un array por una key y suma un campo numérico. */
function sumBy<T>(rows: T[], keyFn: (r: T) => string, valFn: (r: T) => number) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r);
    map.set(k, (map.get(k) ?? 0) + valFn(r));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Fetch ingresos mensuales (factura_emitida.imp_total agrupado por mes)
// ---------------------------------------------------------------------------
async function fetchIngresosMensuales(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("factura_emitida")
    .select("fecha_emision, imp_total");
  if (error) throw error;
  if (!data || data.length === 0) return new Map();
  return sumBy(
    data,
    (r) => (r.fecha_emision as string).slice(0, 7),
    (r) => Number(r.imp_total) || 0,
  );
}

// ---------------------------------------------------------------------------
// Fetch egresos mensuales (factura_recibida.imp_total agrupado por mes)
// ---------------------------------------------------------------------------
async function fetchEgresosMensuales(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("factura_recibida")
    .select("fecha_emision, imp_total");
  if (error) throw error;
  if (!data || data.length === 0) return new Map();
  return sumBy(
    data,
    (r) => (r.fecha_emision as string).slice(0, 7),
    (r) => Number(r.imp_total) || 0,
  );
}

// ---------------------------------------------------------------------------
// Fetch sueldos mensuales (liquidacion_sueldo.sueldo_neto por periodo)
// ---------------------------------------------------------------------------
async function fetchSueldosMensuales(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("liquidacion_sueldo")
    .select("periodo, sueldo_neto");
  if (error) throw error;
  if (!data || data.length === 0) return new Map();
  // periodo ya es YYYY-MM (o podría ser "2025-03" directamente)
  return sumBy(
    data,
    (r) => (r.periodo as string).slice(0, 7),
    (r) => Number(r.sueldo_neto) || 0,
  );
}

// ---------------------------------------------------------------------------
// Fetch ventas por fuente (venta.monto_total agrupado por mes y fuente)
// ---------------------------------------------------------------------------
async function fetchVentasPorFuente(): Promise<IncomeBySource[]> {
  const { data, error } = await supabase
    .from("venta")
    .select("fecha, monto_total, fuente");
  if (error) throw error;
  if (!data || data.length === 0) return [];

  const map = new Map<string, { mostrador: number; servicios: number }>();
  for (const r of data) {
    const p = (r.fecha as string).slice(0, 7);
    const entry = map.get(p) ?? { mostrador: 0, servicios: 0 };
    const monto = Number(r.monto_total) || 0;
    if (r.fuente === "pos") {
      entry.mostrador += monto;
    } else {
      entry.servicios += monto;
    }
    map.set(p, entry);
  }

  return Array.from(map.entries())
    .map(([periodo, v]) => ({ periodo, ...v }))
    .sort((a, b) => a.periodo.localeCompare(b.periodo));
}

// ---------------------------------------------------------------------------
// Consolidar datos del dashboard
// ---------------------------------------------------------------------------
export interface DashboardData {
  kpis: KpiData | null;
  monthly: MonthRow[];
  incomeBySource: IncomeBySource[];
  hasData: boolean;
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const [ingresos, egresos, sueldos, incomeBySource] = await Promise.all([
    fetchIngresosMensuales(),
    fetchEgresosMensuales(),
    fetchSueldosMensuales(),
    fetchVentasPorFuente(),
  ]);

  // Juntar todos los períodos
  const allPeriodos = new Set<string>();
  for (const m of [ingresos, egresos, sueldos]) {
    m.forEach((_, k) => allPeriodos.add(k));
  }

  if (allPeriodos.size === 0) {
    return { kpis: null, monthly: [], incomeBySource: [], hasData: false };
  }

  const sorted = Array.from(allPeriodos).sort();

  // Construir tabla mensual
  const monthly: MonthRow[] = sorted.map((p) => {
    const ing = ingresos.get(p) ?? 0;
    const egr = egresos.get(p) ?? 0;
    const sue = sueldos.get(p) ?? 0;
    const res = ing - egr - sue;
    const margen = ing > 0 ? (res / ing) * 100 : 0;
    return { periodo: p, ingresos: ing, egresos: egr, sueldos: sue, resultado: res, margen };
  });

  // KPIs del último mes
  const last = monthly[monthly.length - 1];
  const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null;

  const kpis: KpiData = {
    ingresos: last.ingresos,
    egresos: last.egresos,
    sueldos: last.sueldos,
    resultado: last.resultado,
    deltaIngresos: prev ? pctDelta(last.ingresos, prev.ingresos) : null,
    deltaEgresos: prev ? pctDelta(last.egresos, prev.egresos) : null,
    deltaSueldos: prev ? pctDelta(last.sueldos, prev.sueldos) : null,
    deltaResultado: prev ? pctDelta(last.resultado, prev.resultado) : null,
    periodo: periodoLabel(last.periodo),
  };

  return { kpis, monthly, incomeBySource, hasData: true };
}

// ---------------------------------------------------------------------------
// Formateo de montos argentinos
// ---------------------------------------------------------------------------
export function formatARS(n: number): string {
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export { periodoLabel };

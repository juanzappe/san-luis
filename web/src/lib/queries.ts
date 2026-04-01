/**
 * Queries para el dashboard Home — Resumen Ejecutivo.
 * Usa una sola llamada RPC (get_resumen_ejecutivo) que devuelve
 * todos los datos mensuales pre-agregados del lado del servidor.
 */
import { supabase } from "./supabase";
import { fetchWithRetry } from "./fetchWithRetry";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface MonthRow {
  periodo: string; // YYYY-MM
  ingresos: number;
  egresosOp: number;
  sueldos: number;
  comerciales: number;
  financieros: number;
  egresosTotal: number;
  resultado: number;
  margen: number; // %
}

export interface KpiData {
  ingresos: number;
  egresosOp: number;
  sueldos: number;
  comerciales: number;
  financieros: number;
  resultado: number;
  deltaIngresos: number | null;
  deltaEgresosOp: number | null;
  deltaSueldos: number | null;
  deltaComerciales: number | null;
  deltaFinancieros: number | null;
  deltaResultado: number | null;
  periodo: string; // "Febrero 2026"
  periodoKey: string; // "2026-02" (for inflation)
}

export interface IncomeBySource {
  periodo: string;
  mostrador: number;
  restobar: number;
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

// ---------------------------------------------------------------------------
// Tipo crudo del RPC
// ---------------------------------------------------------------------------
interface ResumenRow {
  periodo: string;
  mostrador: number;
  restobar: number;
  servicios: number;
  egresos_op: number;
  sueldos: number;
  comerciales: number;
  financieros: number;
}

// ---------------------------------------------------------------------------
// Consolidar datos del dashboard — una sola llamada RPC
// ---------------------------------------------------------------------------
export interface DashboardData {
  kpis: KpiData | null;
  monthly: MonthRow[];
  incomeBySource: IncomeBySource[];
  hasData: boolean;
}

async function fetchDashboardDataInner(): Promise<DashboardData> {
  const { data, error } = await supabase.rpc("get_resumen_ejecutivo");
  if (error) throw error;

  const rows = (data ?? []) as ResumenRow[];
  if (rows.length === 0) {
    return { kpis: null, monthly: [], incomeBySource: [], hasData: false };
  }

  const monthly: MonthRow[] = rows.map((r) => {
    const ing = (Number(r.mostrador) || 0) + (Number(r.restobar) || 0) + (Number(r.servicios) || 0);
    const eOp = Number(r.egresos_op) || 0;
    const sue = Number(r.sueldos) || 0;
    const com = Number(r.comerciales) || 0;
    const fin = Number(r.financieros) || 0;
    const egTotal = eOp + sue + com + fin;
    const res = ing - egTotal;
    return {
      periodo: r.periodo,
      ingresos: ing,
      egresosOp: eOp,
      sueldos: sue,
      comerciales: com,
      financieros: fin,
      egresosTotal: egTotal,
      resultado: res,
      margen: ing > 0 ? (res / ing) * 100 : 0,
    };
  });

  const incomeBySource: IncomeBySource[] = rows.map((r) => ({
    periodo: r.periodo,
    mostrador: Number(r.mostrador) || 0,
    restobar: Number(r.restobar) || 0,
    servicios: Number(r.servicios) || 0,
  }));

  // Find last "complete" month (has ingresos AND at least egresosOp or sueldos)
  let lastCompleteIdx = monthly.length - 1;
  for (let i = monthly.length - 1; i >= 0; i--) {
    if (monthly[i].ingresos > 0 && (monthly[i].egresosOp > 0 || monthly[i].sueldos > 0)) {
      lastCompleteIdx = i;
      break;
    }
  }

  const last = monthly[lastCompleteIdx];
  const prev = lastCompleteIdx >= 1 ? monthly[lastCompleteIdx - 1] : null;

  const kpis: KpiData = {
    ingresos: last.ingresos,
    egresosOp: last.egresosOp,
    sueldos: last.sueldos,
    comerciales: last.comerciales,
    financieros: last.financieros,
    resultado: last.resultado,
    deltaIngresos: prev ? pctDelta(last.ingresos, prev.ingresos) : null,
    deltaEgresosOp: prev ? pctDelta(last.egresosOp, prev.egresosOp) : null,
    deltaSueldos: prev ? pctDelta(last.sueldos, prev.sueldos) : null,
    deltaComerciales: prev ? pctDelta(last.comerciales, prev.comerciales) : null,
    deltaFinancieros: prev ? pctDelta(last.financieros, prev.financieros) : null,
    deltaResultado: prev ? pctDelta(last.resultado, prev.resultado) : null,
    periodo: periodoLabel(last.periodo),
    periodoKey: last.periodo,
  };

  return { kpis, monthly, incomeBySource, hasData: true };
}

export async function fetchDashboardData(
  onRetry?: (attempt: number) => void,
): Promise<DashboardData> {
  return fetchWithRetry(() => fetchDashboardDataInner(), { onRetry });
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

export { periodoLabel, pctDelta };

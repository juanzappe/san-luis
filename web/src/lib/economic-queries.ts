/**
 * Queries for the Económico module (Ingresos, Egresos, Resultado).
 */
import { supabase } from "./supabase";
import { fetchWithRetry } from "./fetchWithRetry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const SHORT_MONTHS = [
  "Ene","Feb","Mar","Abr","May","Jun",
  "Jul","Ago","Sep","Oct","Nov","Dic",
];

export function periodoLabel(p: string): string {
  const [y, m] = p.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

export function shortLabel(p: string): string {
  const [, m] = p.split("-");
  return SHORT_MONTHS[parseInt(m, 10) - 1] ?? m;
}

export function formatARS(n: number): string {
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatPct(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// ---------------------------------------------------------------------------
// Ingresos by source
// ---------------------------------------------------------------------------

export interface IngresoRow {
  periodo: string;
  mostrador: number;
  restobar: number;
  servicios: number;
  total: number;
}

export async function fetchIngresos(): Promise<IngresoRow[]> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_ingresos_mensual");
    if (res.error) throw res.error;
    return res.data;
  });
  type Row = { periodo: string; mostrador: number; restobar: number; servicios: number };
  return ((data ?? []) as Row[])
    .map((r) => {
      const mostrador = Number(r.mostrador) || 0;
      const restobar = Number(r.restobar) || 0;
      const servicios = Number(r.servicios) || 0;
      return { periodo: r.periodo, mostrador, restobar, servicios, total: mostrador + restobar + servicios };
    })
    .sort((a, b) => a.periodo.localeCompare(b.periodo));
}

// ---------------------------------------------------------------------------
// Egresos by cost structure
// ---------------------------------------------------------------------------

export interface EgresoRow {
  periodo: string;
  // Legacy fields (used by fetchResultado for P&L)
  operativos: number; // sueldos + proveedores
  comerciales: number; // impuestos (no ganancias)
  financieros: number; // bank fees & interest
  ganancias: number; // imp. a las ganancias
  total: number;
  // Dynamic category breakdown (from proveedor segmentation)
  categorias: Record<string, number>; // { "Insumos": 1234, "Nafta": 5678, ... }
  sueldos: number;
  impuestos: number;
  sueldosNeto: number; // sueldo_neto with devengamiento (for P&L)
}

// RPC row type for get_egresos_mensual
type RpcEgresoRow = {
  periodo: string;
  sueldos_costo: number;
  sueldos_neto: number;
  proveedores: number;
  impuestos_comerciales: number;
  ganancias: number;
  financieros: number;
};

export async function fetchEgresos(): Promise<EgresoRow[]> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_egresos_mensual");
    if (res.error) throw res.error;
    return res.data;
  });

  return ((data ?? []) as RpcEgresoRow[]).map((r) => {
    const sueldosMes = Number(r.sueldos_costo) || 0;
    const proveedoresMes = Number(r.proveedores) || 0;
    const comerciales = Number(r.impuestos_comerciales) || 0;
    const gan = Number(r.ganancias) || 0;
    const financieros = Number(r.financieros) || 0;
    const impuestosMes = comerciales + gan;
    // Proveedores total goes under "Costos Operativos" category
    const categorias: Record<string, number> = {};
    if (proveedoresMes !== 0) categorias["Costos Operativos"] = proveedoresMes;
    return {
      periodo: r.periodo,
      operativos: sueldosMes + proveedoresMes,
      comerciales,
      financieros,
      ganancias: gan,
      total: sueldosMes + proveedoresMes + comerciales + financieros + gan,
      categorias,
      sueldos: sueldosMes,
      impuestos: impuestosMes,
      sueldosNeto: Number(r.sueldos_neto) || 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Estado de Resultados — full P&L structure
// ---------------------------------------------------------------------------

export interface ResultadoRow {
  periodo: string;
  ingresos: number;
  costosOperativos: number; // proveedores only
  sueldos: number; // sueldo_neto with devengamiento
  margenBruto: number;
  costosComercialesAdmin: number;
  costosFinancieros: number;
  resultadoAntesGanancias: number;
  ganancias: number;
  resultadoNeto: number;
  margenPct: number;
}

export async function fetchResultado(): Promise<ResultadoRow[]> {
  const [ingresos, egresos] = await fetchWithRetry(() =>
    Promise.all([fetchIngresos(), fetchEgresos()])
  );

  const ingMap = new Map(ingresos.map((r) => [r.periodo, r.total]));
  const egrMap = new Map(egresos.map((r) => [r.periodo, r]));

  const allP = new Set<string>();
  ingMap.forEach((_, k) => allP.add(k));
  egrMap.forEach((_, k) => allP.add(k));

  return Array.from(allP)
    .sort()
    .map((p) => {
      const ing = ingMap.get(p) ?? 0;
      const egr = egrMap.get(p);
      // proveedores only (operativos minus sueldos)
      const costosOp = (egr?.operativos ?? 0) - (egr?.sueldos ?? 0);
      const sueldos = egr?.sueldosNeto ?? 0;
      const costosCom = egr?.comerciales ?? 0;
      const costosFin = egr?.financieros ?? 0;
      const gan = egr?.ganancias ?? 0;

      const margenBruto = ing - costosOp - sueldos;
      const resultadoAntesGanancias = margenBruto - costosCom - costosFin;
      const resultadoNeto = resultadoAntesGanancias - gan;
      const margenPct = ing > 0 ? (resultadoNeto / ing) * 100 : 0;

      return {
        periodo: p,
        ingresos: ing,
        costosOperativos: costosOp,
        sueldos,
        margenBruto,
        costosComercialesAdmin: costosCom,
        costosFinancieros: costosFin,
        resultadoAntesGanancias,
        ganancias: gan,
        resultadoNeto,
        margenPct,
      };
    });
}

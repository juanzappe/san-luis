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

export function formatARSAccounting(n: number): string {
  if (n < 0) return `(${formatARS(Math.abs(n))})`;
  return formatARS(n);
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
  cargasSociales: number; // F.931 payments (cargas sociales patronales)
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
  cargas_sociales: number;
};

export async function fetchEgresos(): Promise<EgresoRow[]> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_egresos_mensual");
    if (res.error) throw res.error;
    return res.data;
  });

  // Check if migration 016 (cargas_sociales column) has been applied
  if (data && data.length > 0 && !("cargas_sociales" in data[0])) {
    console.warn(
      "[fetchEgresos] ⚠ La columna cargas_sociales no existe en get_egresos_mensual. " +
      "Ejecutá la migración 016_cargas_sociales_resultado.sql en Supabase."
    );
  }

  return ((data ?? []) as RpcEgresoRow[]).map((r) => {
    const sueldosMes = Number(r.sueldos_costo) || 0;
    const proveedoresMes = Number(r.proveedores) || 0;
    const comerciales = Number(r.impuestos_comerciales) || 0;
    const gan = Number(r.ganancias) || 0;
    const financieros = Number(r.financieros) || 0;
    const cargasSoc = Number(r.cargas_sociales) || 0;
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
      total: sueldosMes + proveedoresMes + comerciales + financieros + gan + cargasSoc,
      categorias,
      sueldos: sueldosMes,
      impuestos: impuestosMes,
      sueldosNeto: Number(r.sueldos_neto) || 0,
      cargasSociales: cargasSoc,
    };
  });
}

// ---------------------------------------------------------------------------
// Ganancias — estimated at effective tax rate + RECPAM-adjusted base
// ---------------------------------------------------------------------------

// Tasa efectiva Imp. Ganancias — promedio 2023-2024 de estados contables auditados
const TASA_GANANCIAS = 0.367;

export { TASA_GANANCIAS };

// RECPAM anual auditado (positivo = pérdida por inflación, negativo = ganancia)
export const RECPAM_HISTORICO: Record<string, number> = {
  "2024": 364599000,
  "2023": 496052700,
  "2022": -61205150,
  "2021": -69080530,
};

// Ratio Posición Monetaria Neta / Ingresos (derivado: 0.218 / 0.10 inflación media 2024)
export const RATIO_PMN = 2.18;

// Inflación mensual de respaldo cuando no hay dato IPC cargado.
// Feb 2026 = 2.9% — actualizar cuando se cargue un dato más reciente.
export const INFLACION_FALLBACK_PCT = 0.029;

/**
 * Devuelve el valor de inflación mensual de respaldo:
 * la entrada más reciente en ipcMap, o INFLACION_FALLBACK_PCT si el mapa está vacío.
 */
export function computeIpcFallback(ipcMap: Map<string, number>): number {
  return ipcMap.size > 0
    ? ipcMap.get([...ipcMap.keys()].sort().at(-1)!)!
    : INFLACION_FALLBACK_PCT;
}

/**
 * Devuelve las ganancias NOMINALES (sin ajuste por inflación) para un período,
 * usando la misma lógica que estado-resultados/page.tsx:
 *   TASA_GANANCIAS × (resultadoAntesGanancias − RECPAM)
 *
 * El llamador debe aplicar adjust() para obtener el valor en pesos constantes.
 * Fuente única de verdad para que Egresos y ER coincidan exactamente.
 */
export function computeGananciasNominal(
  r: ResultadoRow,
  ipcMap: Map<string, number>,
  ipcFallback: number,
): number {
  const year = r.periodo.split("-")[0];
  const recpamNominal = year in RECPAM_HISTORICO
    ? RECPAM_HISTORICO[year] / 12
    : r.ingresos * RATIO_PMN * (ipcMap.get(r.periodo) ?? ipcFallback);
  const resAntesGan = r.resultadoAntesGanancias - recpamNominal;
  return resAntesGan > 0 ? resAntesGan * TASA_GANANCIAS : 0;
}

// ---------------------------------------------------------------------------
// Estado de Resultados — full P&L structure
// ---------------------------------------------------------------------------

export interface ResultadoRow {
  periodo: string;
  ingresos: number;
  costosOperativos: number; // proveedores only
  sueldos: number; // sueldo_neto with devengamiento
  cargasSociales: number; // F.931 cargas sociales patronales
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
      const cargasSociales = egr?.cargasSociales ?? 0;
      const costosCom = egr?.comerciales ?? 0;
      const costosFin = egr?.financieros ?? 0;

      const margenBruto = ing - costosOp - sueldos - cargasSociales;
      const resultadoAntesGanancias = margenBruto - costosCom - costosFin;
      // Ganancias estimated at effective tax rate (36.7%)
      const gan = resultadoAntesGanancias > 0 ? resultadoAntesGanancias * TASA_GANANCIAS : 0;
      const resultadoNeto = resultadoAntesGanancias - gan;
      const margenPct = ing > 0 ? (resultadoNeto / ing) * 100 : 0;

      return {
        periodo: p,
        ingresos: ing,
        costosOperativos: costosOp,
        sueldos,
        cargasSociales,
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

// ---------------------------------------------------------------------------
// Balance — Estados contables (balance_rubro + estado_resultados_contable)
// ---------------------------------------------------------------------------

export interface BalanceRubroRow {
  ejercicio: string;
  fecha_cierre: string;
  seccion: string;
  rubro: string;
  monto: number;
  monto_ejercicio_anterior: number;
  orden: number;
}

export interface EstadoResultadosContableRow {
  ejercicio: string;
  fecha_cierre: string;
  seccion: string;
  linea: string;
  monto: number;
  monto_ejercicio_anterior: number;
  orden: number;
}

export async function fetchBalanceRubros(): Promise<BalanceRubroRow[]> {
  return fetchWithRetry(async () => {
    const { data, error } = await supabase
      .from("balance_rubro")
      .select("ejercicio, fecha_cierre, seccion, rubro, monto, monto_ejercicio_anterior, orden")
      .order("ejercicio")
      .order("orden");
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[])
      .filter((r) => r.rubro !== "nan" && !Number.isNaN(Number(r.monto)))
      .map((r) => ({
        ejercicio: String(r.ejercicio),
        fecha_cierre: String(r.fecha_cierre),
        seccion: String(r.seccion),
        rubro: String(r.rubro),
        monto: Number(r.monto) || 0,
        monto_ejercicio_anterior: Number(r.monto_ejercicio_anterior) || 0,
        orden: Number(r.orden) || 0,
      }));
  });
}

export async function fetchEstadoResultadosContable(): Promise<EstadoResultadosContableRow[]> {
  return fetchWithRetry(async () => {
    const { data, error } = await supabase
      .from("estado_resultados_contable")
      .select("ejercicio, fecha_cierre, seccion, linea, monto, monto_ejercicio_anterior, orden")
      .order("ejercicio")
      .order("orden");
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[])
      .filter((r) => r.linea !== "nan" && !Number.isNaN(Number(r.monto)))
      .map((r) => ({
        ejercicio: String(r.ejercicio),
        fecha_cierre: String(r.fecha_cierre),
        seccion: String(r.seccion),
        linea: String(r.linea),
        monto: Number(r.monto) || 0,
        monto_ejercicio_anterior: Number(r.monto_ejercicio_anterior) || 0,
        orden: Number(r.orden) || 0,
      }));
  });
}

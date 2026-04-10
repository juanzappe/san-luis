/**
 * Shared utilities for YTD day-level cutoff.
 *
 * When the most recent year has partial data in its last month (e.g. data
 * only through April 7), previous years' same month must be truncated to
 * the same day for a fair comparison.
 */
import { supabase } from "./supabase";
import { fetchWithRetry } from "./fetchWithRetry";

const SHORT_MONTHS = [
  "Ene","Feb","Mar","Abr","May","Jun",
  "Jul","Ago","Sep","Oct","Nov","Dic",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface YtdCutoff {
  anio: number;
  mes: number;
  dia: number;
  esFindeMes: boolean;
}

export interface IngresoParcial {
  periodo: string;
  mostrador: number;
  restobar: number;
  servicios: number;
}

export interface EgresoParcial {
  periodo: string;
  proveedores: number;
  financieros: number;
}

export interface UnitParcial {
  periodo: string;
  monto: number;
  cantidad: number;
  txCount: number;
}

export interface ServicioParcial {
  periodo: string;
  publico: number;
  privado: number;
  total: number;
  txCount: number;
}

// ---------------------------------------------------------------------------
// Fetch cutoff date
// ---------------------------------------------------------------------------
export async function fetchFechaCorteYtd(): Promise<YtdCutoff | null> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_fecha_corte_ytd");
    if (res.error) throw res.error;
    return res.data;
  });
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as { anio: number; mes: number; dia: number; es_fin_de_mes: boolean };
  return { anio: r.anio, mes: r.mes, dia: r.dia, esFindeMes: r.es_fin_de_mes };
}

// ---------------------------------------------------------------------------
// Fetch partial-month data (keyed by periodo "YYYY-MM")
// ---------------------------------------------------------------------------
export async function fetchIngresosMesParcial(
  mes: number,
  dia: number,
): Promise<Map<string, IngresoParcial>> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_ingresos_mes_parcial", { p_mes: mes, p_dia: dia });
    if (res.error) throw res.error;
    return res.data;
  });
  const map = new Map<string, IngresoParcial>();
  for (const r of (data ?? []) as { periodo: string; mostrador: number; restobar: number; servicios: number }[]) {
    map.set(r.periodo, {
      periodo: r.periodo,
      mostrador: Number(r.mostrador) || 0,
      restobar: Number(r.restobar) || 0,
      servicios: Number(r.servicios) || 0,
    });
  }
  return map;
}

export async function fetchEgresosMesParcial(
  mes: number,
  dia: number,
): Promise<Map<string, EgresoParcial>> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_egresos_mes_parcial", { p_mes: mes, p_dia: dia });
    if (res.error) throw res.error;
    return res.data;
  });
  const map = new Map<string, EgresoParcial>();
  for (const r of (data ?? []) as { periodo: string; proveedores: number; financieros: number }[]) {
    map.set(r.periodo, {
      periodo: r.periodo,
      proveedores: Number(r.proveedores) || 0,
      financieros: Number(r.financieros) || 0,
    });
  }
  return map;
}

export async function fetchMostradorMesParcial(
  mes: number,
  dia: number,
): Promise<Map<string, UnitParcial>> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_mostrador_mes_parcial", { p_mes: mes, p_dia: dia });
    if (res.error) throw res.error;
    return res.data;
  });
  const map = new Map<string, UnitParcial>();
  for (const r of (data ?? []) as { periodo: string; monto: number; cantidad: number; tx_count: number }[]) {
    map.set(r.periodo, {
      periodo: r.periodo,
      monto: Number(r.monto) || 0,
      cantidad: Number(r.cantidad) || 0,
      txCount: Number(r.tx_count) || 0,
    });
  }
  return map;
}

export async function fetchRestobarMesParcial(
  mes: number,
  dia: number,
): Promise<Map<string, UnitParcial>> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_restobar_mes_parcial", { p_mes: mes, p_dia: dia });
    if (res.error) throw res.error;
    return res.data;
  });
  const map = new Map<string, UnitParcial>();
  for (const r of (data ?? []) as { periodo: string; monto: number; cantidad: number; tx_count: number }[]) {
    map.set(r.periodo, {
      periodo: r.periodo,
      monto: Number(r.monto) || 0,
      cantidad: Number(r.cantidad) || 0,
      txCount: Number(r.tx_count) || 0,
    });
  }
  return map;
}

export async function fetchServiciosMesParcial(
  mes: number,
  dia: number,
): Promise<Map<string, ServicioParcial>> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_servicios_mes_parcial", { p_mes: mes, p_dia: dia });
    if (res.error) throw res.error;
    return res.data;
  });
  const map = new Map<string, ServicioParcial>();
  for (const r of (data ?? []) as { periodo: string; publico: number; privado: number; total: number; tx_count: number }[]) {
    map.set(r.periodo, {
      periodo: r.periodo,
      publico: Number(r.publico) || 0,
      privado: Number(r.privado) || 0,
      total: Number(r.total) || 0,
      txCount: Number(r.tx_count) || 0,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Label helper
// ---------------------------------------------------------------------------

/**
 * Builds the month range label for the YTD comparison title.
 * - Partial month: "Ene–7 Abr"
 * - Full month (cutoff is last day): "Ene–Abr"
 * - No cutoff info: "Ene–Abr" (fallback)
 */
export function ytdMonthRangeLabel(
  firstMonth: string,
  lastMonth: string,
  cutoff?: YtdCutoff | null,
): string {
  const first = SHORT_MONTHS[parseInt(firstMonth, 10) - 1] ?? firstMonth;
  const last = SHORT_MONTHS[parseInt(lastMonth, 10) - 1] ?? lastMonth;
  if (cutoff && !cutoff.esFindeMes && String(cutoff.mes).padStart(2, "0") === lastMonth) {
    return `${first}–${cutoff.dia} ${last}`;
  }
  return `${first}–${last}`;
}

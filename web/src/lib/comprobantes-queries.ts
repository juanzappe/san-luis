/**
 * Queries for the Comprobantes module.
 *
 * Wraps the 3 RPCs defined in 059_comprobantes_recibidos.sql:
 *   - get_comprobantes_recibidos  (paginated + filtered listing)
 *   - get_comprobantes_resumen    (KPIs for the header)
 *   - update_copia_fisica         (write — toggle the "tiene copia" flag)
 */
import { supabase } from "./supabase";
import { fetchWithRetry } from "./fetchWithRetry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComprobantesFilters {
  anio: number | null;
  mes: number | null;
  cuit: string | null;
  tipoComprobante: number | null;
  tieneCopiaFisica: boolean | null;
  search: string | null;
  monto: number | null;
}

export interface ComprobanteRecibido {
  id: number;
  fechaEmision: string;          // ISO YYYY-MM-DD
  tipoComprobante: number;
  puntoVenta: number | null;
  numeroDesde: number | null;
  nroDocEmisor: string | null;
  denominacionEmisor: string | null;
  impNetoGravadoTotal: number;
  totalIva: number;
  impTotal: number;
  tieneCopiaFisica: boolean;
  estado: string;
}

export interface ComprobantesPage {
  rows: ComprobanteRecibido[];
  totalCount: number;
}

export interface ComprobantesResumen {
  totalComprobantes: number;
  conCopia: number;
  sinCopia: number;
  porcentajeCopia: number;
  montoTotal: number;
  proveedoresUnicos: number;
}

// ---------------------------------------------------------------------------
// Tipo de comprobante: código -> nombre legible
// ---------------------------------------------------------------------------

export const TIPO_COMPROBANTE: Record<number, string> = {
  1: "FC A",
  2: "ND A",
  3: "NC A",
  4: "REC A",
  6: "FC B",
  8: "ND B",
  11: "FC C",
  15: "REC C",
  51: "FC M",
  109: "FC T",
};

export function tipoComprobanteLabel(codigo: number): string {
  return TIPO_COMPROBANTE[codigo] ?? String(codigo);
}

/** Tipos disponibles para el filtro del header. */
export const TIPO_COMPROBANTE_OPTIONS: Array<{ value: number; label: string }> =
  Object.entries(TIPO_COMPROBANTE)
    .map(([k, v]) => ({ value: Number(k), label: v }))
    .sort((a, b) => a.value - b.value);

// ---------------------------------------------------------------------------
// Formatters (ARS local — economic-queries.formatARS usa 0 decimales)
// ---------------------------------------------------------------------------

export function formatARS2(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return v.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Formatea PV-Número como "00003-00001234". */
export function formatComprobanteNumero(
  puntoVenta: number | null,
  numeroDesde: number | null,
): string {
  const pv = (puntoVenta ?? 0).toString().padStart(5, "0");
  const nr = (numeroDesde ?? 0).toString().padStart(8, "0");
  return `${pv}-${nr}`;
}

/**
 * Parsea un número en formato argentino.
 *
 * Soporta variantes como:
 *   "355.000,05" → 355000.05
 *   "355000"     → 355000
 *   "355,5"      → 355.5
 *   "1.234.567"  → 1234567
 *
 * Devuelve `null` si el string está vacío o no es parseable.
 */
export function parseARSNumber(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const hasComma = trimmed.includes(",");
  // Si tiene coma, es el separador decimal → los puntos son miles.
  // Si no tiene coma, los puntos se asumen también como separador de miles.
  const normalized = hasComma
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed.replace(/\./g, "");

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// RPC row shapes
// ---------------------------------------------------------------------------

type RpcListRow = {
  id: number;
  fecha_emision: string;
  tipo_comprobante: number;
  punto_venta: number | null;
  numero_desde: number | null;
  nro_doc_emisor: string | null;
  denominacion_emisor: string | null;
  imp_neto_gravado_total: number | null;
  total_iva: number | null;
  imp_total: number | null;
  tiene_copia_fisica: boolean;
  estado: string;
  total_count: number;
};

type RpcResumenRow = {
  total_comprobantes: number;
  con_copia: number;
  sin_copia: number;
  porcentaje_copia: number | null;
  monto_total: number | null;
  proveedores_unicos: number;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function fetchComprobantesRecibidos(
  filters: ComprobantesFilters,
  limit: number,
  offset: number,
): Promise<ComprobantesPage> {
  const rows = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_comprobantes_recibidos", {
      p_anio: filters.anio,
      p_mes: filters.mes,
      p_cuit: filters.cuit && filters.cuit.trim() !== "" ? filters.cuit.trim() : null,
      p_tipo_comprobante: filters.tipoComprobante,
      p_tiene_copia_fisica: filters.tieneCopiaFisica,
      p_search: filters.search && filters.search.trim() !== "" ? filters.search.trim() : null,
      p_monto: filters.monto,
      p_limit: limit,
      p_offset: offset,
    });
    if (res.error) throw res.error;
    return (res.data ?? []) as RpcListRow[];
  });

  const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;

  return {
    totalCount,
    rows: rows.map((r) => ({
      id: Number(r.id),
      fechaEmision: r.fecha_emision,
      tipoComprobante: Number(r.tipo_comprobante),
      puntoVenta: r.punto_venta !== null ? Number(r.punto_venta) : null,
      numeroDesde: r.numero_desde !== null ? Number(r.numero_desde) : null,
      nroDocEmisor: r.nro_doc_emisor,
      denominacionEmisor: r.denominacion_emisor,
      impNetoGravadoTotal: Number(r.imp_neto_gravado_total) || 0,
      totalIva: Number(r.total_iva) || 0,
      impTotal: Number(r.imp_total) || 0,
      tieneCopiaFisica: Boolean(r.tiene_copia_fisica),
      estado: r.estado,
    })),
  };
}

export async function fetchComprobantesResumen(
  anio: number | null,
  mes: number | null,
): Promise<ComprobantesResumen> {
  const row = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_comprobantes_resumen", {
      p_anio: anio,
      p_mes: mes,
    });
    if (res.error) throw res.error;
    const data = (res.data ?? []) as RpcResumenRow[];
    return data[0];
  });

  if (!row) {
    return {
      totalComprobantes: 0,
      conCopia: 0,
      sinCopia: 0,
      porcentajeCopia: 0,
      montoTotal: 0,
      proveedoresUnicos: 0,
    };
  }

  return {
    totalComprobantes: Number(row.total_comprobantes) || 0,
    conCopia: Number(row.con_copia) || 0,
    sinCopia: Number(row.sin_copia) || 0,
    porcentajeCopia: Number(row.porcentaje_copia) || 0,
    montoTotal: Number(row.monto_total) || 0,
    proveedoresUnicos: Number(row.proveedores_unicos) || 0,
  };
}

export async function updateCopiaFisica(
  id: number,
  tieneCopia: boolean,
): Promise<void> {
  const res = await supabase.rpc("update_copia_fisica", {
    p_id: id,
    p_tiene_copia: tieneCopia,
  });
  if (res.error) throw res.error;
}

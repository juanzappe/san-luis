import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// File pattern → fuente detection
// ---------------------------------------------------------------------------

const FILE_PATTERNS: { pattern: RegExp; fuente: string }[] = [
  { pattern: /ARCA.*INGRESOS|MIS_?COMPROBANTES.*EMITIDOS/i, fuente: "arca_ingresos" },
  { pattern: /ARCA.*EGRESOS|MIS_?COMPROBANTES.*RECIBIDOS/i, fuente: "arca_egresos" },
  { pattern: /POSBERRY|MOSTRADOR|VENTAS_?POS/i, fuente: "mostrador" },
  { pattern: /SUELDOS|LIQUIDACION|SICOSS/i, fuente: "sueldos" },
  { pattern: /BP_MOVIMIENTOS|BANCO.*PROVINCIA|5208|EXTRACTO|_extractos/i, fuente: "banco_provincia" },
  { pattern: /MERCADO.?PAGO|MP_/i, fuente: "mercado_pago" },
  { pattern: /MOVIMIENTOS.?CAJA|CAJA/i, fuente: "movimientos_caja" },
  { pattern: /INVERSIONES|IOL|INVERTIR/i, fuente: "inversiones" },
  { pattern: /IMPUESTOS.*NACIONALES|VEP|F\d{3,4}/i, fuente: "impuestos_nacionales" },
  { pattern: /IMPUESTOS.*MUNICIPALES/i, fuente: "impuestos_municipales" },
  { pattern: /EECC|BALANCE|ESTADO.*CONTABLE/i, fuente: "eecc" },
  { pattern: /SERVICIOS|factura_emitida_detalle/i, fuente: "servicios" },
  { pattern: /SEGMENTACION/i, fuente: "segmentacion" },
  { pattern: /PRODUCTO/i, fuente: "productos" },
];

export function detectFuente(filename: string): string | null {
  for (const { pattern, fuente } of FILE_PATTERNS) {
    if (pattern.test(filename)) return fuente;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fuente metadata
// ---------------------------------------------------------------------------

export interface FuenteInfo {
  key: string;
  label: string;
  loader: string;
}

export const FUENTES: FuenteInfo[] = [
  { key: "arca_ingresos", label: "ARCA (Ingresos)", loader: "arca_ingresos" },
  { key: "arca_egresos", label: "ARCA (Egresos)", loader: "arca_egresos" },
  { key: "mostrador", label: "Posberry POS", loader: "mostrador" },
  { key: "sueldos", label: "SICOSS/Sueldos", loader: "sueldos" },
  { key: "banco_provincia", label: "Banco Provincia", loader: "banco_provincia" },
  { key: "mercado_pago", label: "Mercado Pago", loader: "mercado_pago" },
  { key: "movimientos_caja", label: "Caja diaria", loader: "movimientos_caja" },
  { key: "inversiones", label: "InvertirOnline", loader: "inversiones" },
  { key: "impuestos_nacionales", label: "Impuestos Nacionales", loader: "impuestos_nacionales" },
  { key: "impuestos_municipales", label: "Impuestos Municipales", loader: "impuestos_municipales" },
  { key: "eecc", label: "EECC Auditados", loader: "eecc" },
  { key: "servicios", label: "Servicios/Catering", loader: "servicios" },
  { key: "segmentacion", label: "Segmentación", loader: "segmentacion" },
  { key: "productos", label: "Productos", loader: "productos" },
];

export function fuenteLabel(key: string): string {
  return FUENTES.find((f) => f.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportLogRow {
  id: number;
  archivo: string;
  fuente: string;
  tamano_bytes: number | null;
  registros_procesados: number | null;
  estado: string;
  error_mensaje: string | null;
  created_at: string;
}

export type FileStatus = "pendiente" | "guardando" | "guardado" | "procesando" | "procesado" | "error";

export interface FileQueueItem {
  id: string;
  file: File;
  fuente: string | null;
  status: FileStatus;
  error?: string;
  registros?: number;
  logId?: number;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function uploadFile(
  file: File,
  fuente: string
): Promise<{ ok: boolean; logId?: number; error?: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("fuente", fuente);

  const res = await fetch("/api/upload", { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data.error ?? "Error al subir archivo" };
  return { ok: true, logId: data.logId };
}

export interface LoaderResult {
  loader: string;
  ok: boolean;
  registros: number | null;
  output: string;
  error?: string;
}

export interface RunLoadersResponse {
  ok: boolean;
  results: LoaderResult[];
  refresh: { ok: boolean; elapsed_ms: number; error?: string } | null;
}

/**
 * Ejecuta uno o más loaders en orden y refresca los materialized views
 * al final (una sola vez para todo el batch).
 */
export async function runLoaders(
  loaders: string[],
  logIdsByLoader?: Record<string, number[]>,
): Promise<RunLoadersResponse> {
  const res = await fetch("/api/etl/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loaders, logIdsByLoader }),
  });
  const data = await res.json();
  // El endpoint devuelve 207 si hay alguno con error, pero igual tiene results.
  if (!data?.results) {
    return {
      ok: false,
      results: [],
      refresh: null,
    };
  }
  return data as RunLoadersResponse;
}

// ---------------------------------------------------------------------------
// Import log from Supabase
// ---------------------------------------------------------------------------

export async function fetchImportLog(): Promise<ImportLogRow[]> {
  const { data, error } = await supabase
    .from("import_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ImportLogRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

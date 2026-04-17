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
  { pattern: /SANTANDER|santander/i, fuente: "movimiento_santander" },
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
  { key: "movimiento_santander", label: "Banco Santander", loader: "movimiento_santander" },
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
// Grupos visibles en la Card "Fuentes disponibles"
// ---------------------------------------------------------------------------

export interface FuenteGroupItem {
  label: string;
  description?: string;
  loader: string;
  formats: string[];
}

export interface FuenteGroup {
  title: string;
  items: FuenteGroupItem[];
}

export const FUENTES_GROUPS: FuenteGroup[] = [
  {
    title: "Posberry",
    items: [
      {
        label: "Detalle de ventas",
        description: "XLSX con sheet ventas_detalle",
        loader: "mostrador",
        formats: ["xlsx"],
      },
      {
        label: "Movimientos de caja",
        description: "XLSX con sheet movcaja",
        loader: "movimientos_caja",
        formats: ["xlsx"],
      },
    ],
  },
  {
    title: "ARCA (AFIP)",
    items: [
      {
        label: "Facturas emitidas (ingresos)",
        description: "Mis Comprobantes Emitidos",
        loader: "arca_ingresos",
        formats: ["csv"],
      },
      {
        label: "Facturas recibidas (egresos)",
        description: "Mis Comprobantes Recibidos",
        loader: "arca_egresos",
        formats: ["csv"],
      },
      {
        label: "Servicios / catering",
        description: "Detalle de facturas ZIP",
        loader: "servicios",
        formats: ["zip"],
      },
    ],
  },
  {
    title: "Bancos",
    items: [
      {
        label: "Banco Provincia",
        description: "Extractos",
        loader: "banco_provincia",
        formats: ["txt", "xlsx"],
      },
      {
        label: "Banco Santander",
        description: "Extractos",
        loader: "movimiento_santander",
        formats: ["pdf", "csv"],
      },
      {
        label: "Mercado Pago",
        description: "Reporte de movimientos",
        loader: "mercado_pago",
        formats: ["xlsx", "csv"],
      },
    ],
  },
  {
    title: "Sueldos e Impuestos",
    items: [
      {
        label: "Liquidaciones mensuales",
        description: "SICOSS / sueldos",
        loader: "sueldos",
        formats: ["xlsx"],
      },
      {
        label: "Impuestos Nacionales",
        description: "VEPs AFIP",
        loader: "impuestos_nacionales",
        formats: ["csv"],
      },
      {
        label: "Impuestos Municipales",
        description: "Tasas",
        loader: "impuestos_municipales",
        formats: ["pdf"],
      },
    ],
  },
  {
    title: "Inversiones",
    items: [
      {
        label: "InvertirOnline",
        description: "Tenencias + movimientos",
        loader: "inversiones",
        formats: ["xlsx"],
      },
    ],
  },
  {
    title: "Contable / Maestros",
    items: [
      {
        label: "EECC auditados",
        description: "XLSX con hojas ESP $ y ER $",
        loader: "eecc",
        formats: ["xlsx"],
      },
      {
        label: "Productos (catálogo)",
        description: "XLSX sheet Productos",
        loader: "productos",
        formats: ["xlsx"],
      },
      {
        label: "Segmentación",
        description: "4 CSV: clientes, proveedores, categorías, sectores",
        loader: "segmentacion",
        formats: ["csv"],
      },
    ],
  },
];

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

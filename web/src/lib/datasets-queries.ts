import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Dataset metadata (hardcoded mapping)
// ---------------------------------------------------------------------------

type DatasetTipo = "operativa" | "anual" | "catalogo";

interface DatasetMeta {
  tabla: string;
  fuente: string;
  tipo: DatasetTipo;
}

const DATASETS: DatasetMeta[] = [
  { tabla: "venta", fuente: "Posberry POS", tipo: "operativa" },
  { tabla: "venta_detalle", fuente: "Posberry POS", tipo: "operativa" },
  { tabla: "factura_emitida", fuente: "ARCA (Ingresos)", tipo: "operativa" },
  { tabla: "factura_recibida", fuente: "ARCA (Egresos)", tipo: "operativa" },
  { tabla: "movimiento_bancario", fuente: "Banco Provincia", tipo: "operativa" },
  { tabla: "movimiento_mp", fuente: "Mercado Pago", tipo: "operativa" },
  { tabla: "movimiento_caja", fuente: "Caja diaria", tipo: "operativa" },
  { tabla: "liquidacion_sueldo", fuente: "SICOSS/Sueldos", tipo: "operativa" },
  { tabla: "pago_impuesto", fuente: "ARCA (VEPs)", tipo: "operativa" },
  { tabla: "balance_rubro", fuente: "EECC Auditados", tipo: "anual" },
  { tabla: "estado_resultados_contable", fuente: "EECC Auditados", tipo: "anual" },
  { tabla: "indicador_macro", fuente: "ArgentinaDatos API", tipo: "operativa" },
  { tabla: "inversion", fuente: "InvertirOnline", tipo: "operativa" },
  { tabla: "inversion_movimiento", fuente: "InvertirOnline", tipo: "operativa" },
  { tabla: "cliente", fuente: "ARCA", tipo: "catalogo" },
  { tabla: "proveedor", fuente: "ARCA", tipo: "catalogo" },
  { tabla: "empleado", fuente: "SICOSS", tipo: "catalogo" },
  { tabla: "producto", fuente: "Posberry", tipo: "catalogo" },
  { tabla: "categoria_egreso", fuente: "Manual", tipo: "catalogo" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DatasetEstado = "al_dia" | "anual" | "desactualizado" | "catalogo";

export interface DatasetRow {
  tabla: string;
  fuente: string;
  tipo: DatasetTipo;
  registros: number;
  primerDato: string | null; // YYYY-MM-DD
  ultimoDato: string | null; // YYYY-MM-DD
  coberturaMeses: number | null;
  estado: DatasetEstado;
}

export interface DatasetMonthlyRow {
  periodo: string;
  registros: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STALE_DAYS = 45;

function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T12:00:00").getTime() - new Date(a + "T12:00:00").getTime()) /
      (1000 * 60 * 60 * 24),
  );
}

function cobertura(primer: string | null, ultimo: string | null): number | null {
  if (!primer || !ultimo) return null;
  const d1 = new Date(primer);
  const d2 = new Date(ultimo);
  return (
    (d2.getFullYear() - d1.getFullYear()) * 12 +
    (d2.getMonth() - d1.getMonth()) +
    1
  );
}

function computeEstado(
  tipo: DatasetTipo,
  ultimoDato: string | null
): DatasetEstado {
  if (tipo === "catalogo") return "catalogo";
  if (tipo === "anual") return "anual";
  if (!ultimoDato) return "desactualizado";
  const today = new Date().toISOString().slice(0, 10);
  return diffDays(ultimoDato, today) <= STALE_DAYS ? "al_dia" : "desactualizado";
}

export function formatNumber(n: number): string {
  return n.toLocaleString("es-AR");
}

export function formatDateAR(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// Status sort order: desactualizado first, then al_dia, anual, catalogo
// ---------------------------------------------------------------------------

const ESTADO_ORDER: Record<DatasetEstado, number> = {
  desactualizado: 0,
  al_dia: 1,
  anual: 2,
  catalogo: 3,
};

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

export async function fetchDatasetsStatus(): Promise<DatasetRow[]> {
  const { data, error } = await supabase.rpc("get_datasets_status");
  if (error) throw error;

  type RpcRow = {
    tabla: string;
    registros: number;
    primer_dato: string | null;
    ultimo_dato: string | null;
  };
  const rows = (data ?? []) as RpcRow[];
  const rpcMap = new Map<string, RpcRow>();
  for (const r of rows) rpcMap.set(r.tabla, r);

  const result: DatasetRow[] = DATASETS.map((meta) => {
    const rpc = rpcMap.get(meta.tabla);
    const registros = Number(rpc?.registros ?? 0);
    const primerDato = rpc?.primer_dato ?? null;
    const ultimoDato = rpc?.ultimo_dato ?? null;
    return {
      tabla: meta.tabla,
      fuente: meta.fuente,
      tipo: meta.tipo,
      registros,
      primerDato,
      ultimoDato,
      coberturaMeses: cobertura(primerDato, ultimoDato),
      estado: computeEstado(meta.tipo, ultimoDato),
    };
  });

  result.sort((a, b) => {
    const so = ESTADO_ORDER[a.estado] - ESTADO_ORDER[b.estado];
    if (so !== 0) return so;
    return b.registros - a.registros;
  });

  return result;
}

export async function fetchDatasetMonthly(
  tabla: string
): Promise<DatasetMonthlyRow[]> {
  const { data, error } = await supabase.rpc("get_dataset_monthly", {
    p_tabla: tabla,
  });
  if (error) throw error;
  return ((data ?? []) as { periodo: string; registros: number }[]).map(
    (r) => ({
      periodo: String(r.periodo),
      registros: Number(r.registros) || 0,
    })
  );
}

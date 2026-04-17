/**
 * Queries for the Económico module (Ingresos, Egresos, Resultado).
 */
import { supabase } from "./supabase";
import { fetchWithRetry } from "./fetchWithRetry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Período mínimo para la sección Económicos (excluye 2021-2023). */
export const ECONOMICO_MIN_PERIODO = "2024-01";

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
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .filter((r) => r.periodo >= ECONOMICO_MIN_PERIODO);
}

// ---------------------------------------------------------------------------
// Egresos by cost structure
// ---------------------------------------------------------------------------

/**
 * Categorías de proveedor (factura_recibida) que se contabilizan con Gastos
 * Comerciales en lugar de Costos Operativos.
 */
export const COMERCIALES_PROVEEDOR_CATS = [
  "Honorarios",
  "Seguros",
  "Telefonía",
  "Servicios públicos",
] as const;

/**
 * Label legible para una combinación (categoria_egreso, subcategoria).
 * Después de la migración 079 la subcategoría quedó deprecada — esta función
 * simplemente devuelve `categoria` en el caso común.
 */
export function displayCategoriaLabel(categoria: string, _subcategoria: string | null): string {
  return categoria;
}

/**
 * Allowlist canónica para Costos Operativos (migración 079).
 * Lo que no esté acá cae a "Otros".
 */
export const PROVEEDOR_CATEGORIAS_OPERATIVAS = [
  "Alimentos",
  "Bebidas",
  "Limpieza/Papelería",
  "Construcción y mantenimiento",
  "Nafta",
  "Servicios Profesionales",
  "Otros",
] as const;

/**
 * Allowlist canónica para Gastos Comerciales (vía proveedor).
 */
export const PROVEEDOR_CATEGORIAS_COMERCIALES = [
  "Honorarios",
  "Seguros",
  "Telefonía",
  "Servicios públicos",
  "Otros",
] as const;

export const COSTOS_OPERATIVOS_OTROS = "Otros";

/**
 * Orden de columnas para Costos Operativos. Mismo contenido que
 * PROVEEDOR_CATEGORIAS_OPERATIVAS, dejado acá por compatibilidad con
 * consumidores existentes.
 */
export const COSTOS_OPERATIVOS_ORDER: string[] = [...PROVEEDOR_CATEGORIAS_OPERATIVAS];

/**
 * Red de seguridad: si llega una categoría fuera de la whitelist
 * (proveedor sin clasificar, etc.) la mandamos a "Otros".
 * Preserva Honorarios/Seguros/Telefonía/Servicios públicos intactos
 * (los rutea el main page hacia Gastos Comerciales).
 */
export function rollupCostosOperativos(cats: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  const opAllowed = new Set<string>(PROVEEDOR_CATEGORIAS_OPERATIVAS);
  for (const [k, v] of Object.entries(cats)) {
    if ((COMERCIALES_PROVEEDOR_CATS as readonly string[]).includes(k)) {
      out[k] = (out[k] ?? 0) + v;
      continue;
    }
    const mapped = opAllowed.has(k) ? k : COSTOS_OPERATIVOS_OTROS;
    out[mapped] = (out[mapped] ?? 0) + v;
  }
  return out;
}

export interface EgresoRow {
  periodo: string;
  // Legacy fields (used by fetchResultado for P&L)
  operativos: number; // sueldos + proveedores
  comerciales: number; // impuestos (no ganancias)
  financieros: number; // bank fees & interest
  ganancias: number; // imp. a las ganancias
  gananciasBase: number; // resultado antes de ganancias (pre-clamp, for correct annual aggregation)
  total: number;
  // Dynamic category breakdown (from proveedor segmentation)
  categorias: Record<string, number>; // { "Insumos — Alimentos": 1234, "Nafta": 5678, ... }
  sueldos: number;
  impuestos: number;
  sueldosNeto: number; // sueldo_neto with devengamiento (for P&L)
  cargasSociales: number; // F.931 payments (cargas sociales patronales)
}

// RPC row type for get_egresos_por_categoria_mensual (migration 077)
type RpcEgresoCategoriaRow = {
  periodo: string;
  categoria_egreso: string;
  subcategoria: string | null;
  total: number;
};

export interface EgresoPorCategoria {
  periodo: string;
  label: string; // display label from displayCategoriaLabel
  categoria: string; // raw categoria_egreso
  subcategoria: string | null;
  total: number;
}

export async function fetchEgresosPorCategoria(): Promise<EgresoPorCategoria[]> {
  try {
    const data = await fetchWithRetry(async () => {
      const res = await supabase.rpc("get_egresos_por_categoria_mensual");
      if (res.error) throw res.error;
      return res.data;
    });
    return ((data ?? []) as RpcEgresoCategoriaRow[])
      .map((r) => ({
        periodo: r.periodo,
        label: displayCategoriaLabel(r.categoria_egreso, r.subcategoria),
        categoria: r.categoria_egreso,
        subcategoria: r.subcategoria,
        total: Number(r.total) || 0,
      }))
      .filter((r) => r.periodo >= ECONOMICO_MIN_PERIODO);
  } catch (err) {
    // RPC aún no aplicada (migración 077). Devolver vacío; el consumidor
    // hará fallback al total agregado de `get_egresos_mensual`.
    console.warn("[fetchEgresosPorCategoria] RPC no disponible — falta migración 077?", err);
    return [];
  }
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
  const [data, porCategoria] = await Promise.all([
    fetchWithRetry(async () => {
      const res = await supabase.rpc("get_egresos_mensual");
      if (res.error) throw res.error;
      return res.data;
    }),
    fetchEgresosPorCategoria(),
  ]);

  // Check if migration 016 (cargas_sociales column) has been applied
  if (data && data.length > 0 && !("cargas_sociales" in data[0])) {
    console.warn(
      "[fetchEgresos] ⚠ La columna cargas_sociales no existe en get_egresos_mensual. " +
      "Ejecutá la migración 016_cargas_sociales_resultado.sql en Supabase."
    );
  }

  // Build per-periodo map of category breakdown from migration 077's RPC.
  // Si la RPC no está disponible, el map queda vacío y caemos al total agregado.
  const breakdownByPeriodo = new Map<string, Record<string, number>>();
  for (const c of porCategoria) {
    const cur = breakdownByPeriodo.get(c.periodo) ?? {};
    cur[c.label] = (cur[c.label] ?? 0) + c.total;
    breakdownByPeriodo.set(c.periodo, cur);
  }

  return ((data ?? []) as RpcEgresoRow[]).map((r) => {
    const sueldosMes = Number(r.sueldos_costo) || 0;
    const proveedoresMes = Number(r.proveedores) || 0;
    const comerciales = Number(r.impuestos_comerciales) || 0;
    const gan = Number(r.ganancias) || 0;
    const financieros = Number(r.financieros) || 0;
    const cargasSoc = Number(r.cargas_sociales) || 0;
    const impuestosMes = comerciales + gan;
    // Categorías de proveedor: breakdown del RPC 077, consolidado por rollup
    // (whitelist + "Otros"). Si la RPC aún no está, caemos al total en "Otros".
    const rpcCats = breakdownByPeriodo.get(r.periodo);
    const categorias: Record<string, number> = rpcCats
      ? rollupCostosOperativos(rpcCats)
      : proveedoresMes !== 0 ? { [COSTOS_OPERATIVOS_OTROS]: proveedoresMes } : {};
    return {
      periodo: r.periodo,
      operativos: sueldosMes + proveedoresMes,
      comerciales,
      financieros,
      ganancias: gan,
      gananciasBase: 0, // overridden in useEgresosData with RECPAM-adjusted base
      total: sueldosMes + proveedoresMes + comerciales + financieros + gan + cargasSoc,
      categorias,
      sueldos: sueldosMes,
      impuestos: impuestosMes,
      sueldosNeto: Number(r.sueldos_neto) || 0,
      cargasSociales: cargasSoc,
    };
  }).filter((r) => r.periodo >= ECONOMICO_MIN_PERIODO);
}

// ---------------------------------------------------------------------------
// Ganancias — estimated at effective tax rate + RECPAM-adjusted base
// ---------------------------------------------------------------------------

// Tasa efectiva Imp. Ganancias — default: promedio 2023-2024 de EECC auditados.
// Se puede recalcular dinámicamente con computeTasasEfectivasFromEECC() cuando
// haya data de ejercicios más recientes.
const TASA_GANANCIAS = 0.367;

export { TASA_GANANCIAS };

/**
 * Calcula la tasa efectiva del Impuesto a las Ganancias para cada ejercicio
 * disponible en el Estado de Resultados Contable, y devuelve también el
 * promedio de los últimos N años (default 2).
 *
 * Tasa efectiva = |monto(Impuesto a las ganancias)| / monto(Resultado antes del impuesto)
 *
 * Si no hay datos suficientes, devuelve el fallback hardcoded.
 */
export function computeTasasEfectivasFromEECC(
  eecc: EstadoResultadosContableRow[],
  ultimosN: number = 2,
): { porEjercicio: Record<string, number>; promedio: number; fuente: "eecc" | "fallback" } {
  // Agrupamos por ejercicio
  const porEjercicio = new Map<string, { impuesto: number; resultado: number }>();
  for (const r of eecc) {
    const key = String(r.ejercicio);
    const cur = porEjercicio.get(key) ?? { impuesto: 0, resultado: 0 };
    const linea = r.linea.toLowerCase();
    if (linea.includes("impuesto a las ganancias")) {
      cur.impuesto = Math.abs(r.monto);
    }
    if (linea.includes("resultado antes del impuesto")) {
      cur.resultado = r.monto;
    }
    porEjercicio.set(key, cur);
  }

  const tasas: Record<string, number> = {};
  porEjercicio.forEach(({ impuesto, resultado }, year) => {
    if (resultado > 0 && impuesto > 0) {
      tasas[year] = impuesto / resultado;
    }
  });

  const sorted = Object.keys(tasas).sort().slice(-ultimosN);
  if (sorted.length === 0) {
    return { porEjercicio: {}, promedio: TASA_GANANCIAS, fuente: "fallback" };
  }
  const promedio = sorted.reduce((s, y) => s + tasas[y], 0) / sorted.length;
  return { porEjercicio: tasas, promedio, fuente: "eecc" };
}

// RECPAM anual auditado (positivo = pérdida por inflación, negativo = ganancia)
export const RECPAM_HISTORICO: Record<string, number> = {
  "2024": 364598954,  // Balance auditado 2024 (nominal, sin ajuste por inflación)
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
    ? ipcMap.get(Array.from(ipcMap.keys()).sort().at(-1)!)!
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
/**
 * Devuelve la base imponible NOMINAL de Ganancias (resultado antes de ganancias − RECPAM),
 * SIN clampar a 0. El llamador decide si aplica max(0,...) × TASA_GANANCIAS.
 * Necesaria para agregar correctamente a nivel trimestral/anual.
 */
export function computeGananciasBaseNominal(
  r: ResultadoRow,
  ipcMap: Map<string, number>,
  ipcFallback: number,
): number {
  const year = r.periodo.split("-")[0];
  const recpamNominal = year in RECPAM_HISTORICO
    ? RECPAM_HISTORICO[year] / 12
    : r.ingresos * RATIO_PMN * (ipcMap.get(r.periodo) ?? ipcFallback);
  return r.resultadoAntesGanancias - recpamNominal;
}

export function computeGananciasNominal(
  r: ResultadoRow,
  ipcMap: Map<string, number>,
  ipcFallback: number,
): number {
  const base = computeGananciasBaseNominal(r, ipcMap, ipcFallback);
  return base > 0 ? base * TASA_GANANCIAS : 0;
}

// ---------------------------------------------------------------------------
// Estado de Resultados — full P&L structure
// ---------------------------------------------------------------------------

export interface ResultadoRow {
  periodo: string;
  ingresos: number;
  costosOperativos: number; // proveedores — excluye las 4 categorías que van a Gastos Comerciales
  comercialesProveedor: number; // Honorarios+Seguros+Telefonía+Servicios públicos (van a Gastos Comerciales)
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
      // Proveedores total (operativos - sueldos)
      const provTotal = (egr?.operativos ?? 0) - (egr?.sueldos ?? 0);
      // Separar los 4 buckets que van a Gastos Comerciales (Honorarios, Seguros,
      // Telefonía, Servicios públicos) usando el breakdown de r.categorias.
      // Si la RPC 077 no está aplicada, categorias tiene solo {Otros: total}
      // y comercialesProveedor queda en 0 (comportamiento seguro).
      let comercialesProv = 0;
      if (egr) {
        for (const cat of COMERCIALES_PROVEEDOR_CATS) {
          comercialesProv += egr.categorias[cat] ?? 0;
        }
      }
      const costosOp = provTotal - comercialesProv;
      const sueldos = egr?.sueldosNeto ?? 0;
      const cargasSociales = egr?.cargasSociales ?? 0;
      // Costos Comerciales & Financieros: set to 0 here, overridden by the page
      // using data from fetchResumenFiscal() to avoid duplicating tax logic
      const costosCom = 0;
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
        comercialesProveedor: comercialesProv,
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

// ---------------------------------------------------------------------------
// Gastos Financieros — desglose por categoría
// ---------------------------------------------------------------------------

export interface FinancierosDesglose {
  periodo: string;
  comisionesBancarias: number;
  intereses: number;
  seguros: number;
  comisionesMp: number;
  otros: number;
  total: number;
}

export async function fetchFinancierosDesglose(): Promise<FinancierosDesglose[]> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_financieros_desglosado");
    if (res.error) throw res.error;
    return res.data;
  });
  type Row = {
    periodo: string;
    comisiones_bancarias: number;
    intereses: number;
    seguros: number;
    comisiones_mp: number;
    otros: number;
  };
  return ((data ?? []) as Row[])
    .map((r) => {
      const comisionesBancarias = Number(r.comisiones_bancarias) || 0;
      const intereses = Number(r.intereses) || 0;
      const seguros = Number(r.seguros) || 0;
      const comisionesMp = Number(r.comisiones_mp) || 0;
      const otros = Number(r.otros) || 0;
      return {
        periodo: r.periodo,
        comisionesBancarias,
        intereses,
        seguros,
        comisionesMp,
        otros,
        total: comisionesBancarias + intereses + seguros + comisionesMp + otros,
      };
    })
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .filter((r) => r.periodo >= ECONOMICO_MIN_PERIODO);
}

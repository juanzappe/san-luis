/**
 * Queries for the Económico module (Ingresos, Egresos, Resultado).
 */
import { supabase } from "./supabase";

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

/**
 * Paginated fetch to overcome Supabase REST 1000-row limit.
 */
async function fetchAllRows<T>(
  table: string,
  columns: string,
  filter?: { column: string; value: string | number },
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    let query = supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) {
      query = query.eq(filter.column, filter.value);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/**
 * Devengamiento: assign salary to the month it corresponds to.
 * - SAC (aguinaldo): accrue to payment month
 * - day < 20: accrue to previous month
 * - day >= 20: accrue to transfer month
 * - null fecha_transferencia: fall back to periodo
 */
function accrualPeriod(r: { periodo: string; fecha_transferencia: string | null }): string {
  const isSAC = r.periodo.endsWith("-SAC");
  if (!r.fecha_transferencia) return r.periodo.slice(0, 7);

  const ft = new Date(r.fecha_transferencia + "T12:00:00");
  const day = ft.getDate();
  const ftMonth = r.fecha_transferencia.slice(0, 7);

  if (isSAC) return ftMonth;

  if (day < 20) {
    const y = ft.getFullYear();
    const m = ft.getMonth(); // 0-indexed
    return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
  }
  return ftMonth;
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
  const { data, error } = await supabase.rpc("get_ingresos_mensual");
  if (error) throw error;
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

export async function fetchEgresos(): Promise<EgresoRow[]> {
  // 1) Sueldos — paginated, with devengamiento
  const sueldosData = await fetchAllRows<{
    periodo: string;
    costo_total_empresa: number | null;
    sueldo_neto: number;
    fecha_transferencia: string | null;
  }>("liquidacion_sueldo", "periodo, costo_total_empresa, sueldo_neto, fecha_transferencia");

  // costo_total_empresa with devengamiento (for egresos page)
  const sueldosMap = new Map<string, number>();
  // sueldo_neto with devengamiento (for P&L)
  const sueldosNetoMap = new Map<string, number>();
  for (const s of sueldosData) {
    const p = accrualPeriod(s);
    sueldosMap.set(p, (sueldosMap.get(p) ?? 0) + (Number(s.costo_total_empresa ?? s.sueldo_neto) || 0));
    sueldosNetoMap.set(p, (sueldosNetoMap.get(p) ?? 0) + (Number(s.sueldo_neto) || 0));
  }

  // 2) Facturas recibidas + proveedor segmentación — paginated
  const [factRecData, provData] = await Promise.all([
    fetchAllRows<{ fecha_emision: string; imp_neto_gravado_total: number; nro_doc_emisor: string | null; tipo_comprobante: number | null }>(
      "factura_recibida",
      "fecha_emision, imp_neto_gravado_total, nro_doc_emisor, tipo_comprobante",
    ),
    fetchAllRows<{ cuit: string | null; categoria_egreso: string | null }>(
      "proveedor",
      "cuit, categoria_egreso",
    ),
  ]);

  // Build CUIT → categoria lookup
  const cuitToCategoria = new Map<string, string>();
  for (const p of provData) {
    if (p.cuit && p.categoria_egreso) cuitToCategoria.set(p.cuit, p.categoria_egreso);
  }

  // Group facturas by periodo + categoria
  const catMap = new Map<string, Map<string, number>>();
  const proveedoresTotalMap = new Map<string, number>();
  for (const f of factRecData) {
    const periodo = (f.fecha_emision as string).slice(0, 7);
    const raw = Number(f.imp_neto_gravado_total) || 0;
    const monto = [3, 8, 203].includes(Number(f.tipo_comprobante)) ? -raw : raw;
    const cuit = f.nro_doc_emisor;
    const cat = (cuit ? cuitToCategoria.get(cuit) : null) ?? "Sin clasificar";

    if (!catMap.has(periodo)) catMap.set(periodo, new Map());
    const pm = catMap.get(periodo)!;
    pm.set(cat, (pm.get(cat) ?? 0) + monto);

    proveedoresTotalMap.set(periodo, (proveedoresTotalMap.get(periodo) ?? 0) + monto);
  }

  // 3) Impuestos — two separate paginated fetches (avoids fragile JOIN)
  const [pagosData, oblData] = await Promise.all([
    fetchAllRows<{ fecha_pago: string; monto: number; impuesto_obligacion_id: number | null }>(
      "pago_impuesto",
      "fecha_pago, monto, impuesto_obligacion_id",
    ),
    fetchAllRows<{ id: number; tipo: string }>(
      "impuesto_obligacion",
      "id, tipo",
    ),
  ]);

  const oblMap = new Map(oblData.map((o) => [o.id, o.tipo]));
  const impComercialMap = new Map<string, number>();
  const gananciasMap = new Map<string, number>();

  for (const pago of pagosData) {
    const p = (pago.fecha_pago as string).slice(0, 7);
    const monto = Number(pago.monto) || 0;
    const tipo = pago.impuesto_obligacion_id
      ? (oblMap.get(pago.impuesto_obligacion_id) ?? "")
      : "";
    if (tipo === "ganancias") {
      gananciasMap.set(p, (gananciasMap.get(p) ?? 0) + monto);
    } else {
      impComercialMap.set(p, (impComercialMap.get(p) ?? 0) + monto);
    }
  }

  // 4) Bank fees — paginated
  const movBanco = await fetchAllRows<{ fecha: string; concepto: string; debito: number }>(
    "movimiento_bancario",
    "fecha, concepto, debito",
  );

  const financierosMap = new Map<string, number>();
  for (const m of movBanco) {
    const concepto = (m.concepto ?? "").toLowerCase();
    const debito = Number(m.debito) || 0;
    if (debito <= 0) continue;
    if (
      concepto.includes("comision") ||
      concepto.includes("interes") ||
      concepto.includes("impuesto s/deb") ||
      concepto.includes("impuesto s/cred") ||
      concepto.includes("mantenimiento") ||
      concepto.includes("seguro") ||
      concepto.includes("sellado")
    ) {
      const p = (m.fecha as string).slice(0, 7);
      financierosMap.set(p, (financierosMap.get(p) ?? 0) + debito);
    }
  }

  // Merge all periodos
  const allP = new Set<string>();
  for (const mp of [sueldosMap, proveedoresTotalMap, impComercialMap, gananciasMap, financierosMap]) {
    mp.forEach((_, k) => allP.add(k));
  }

  return Array.from(allP)
    .sort()
    .map((p) => {
      const sueldosMes = sueldosMap.get(p) ?? 0;
      const proveedoresMes = proveedoresTotalMap.get(p) ?? 0;
      const comerciales = impComercialMap.get(p) ?? 0;
      const gan = gananciasMap.get(p) ?? 0;
      const financieros = financierosMap.get(p) ?? 0;
      const impuestosMes = comerciales + gan;
      const categorias: Record<string, number> = {};
      const pm = catMap.get(p);
      if (pm) pm.forEach((v, k) => { categorias[k] = v; });
      return {
        periodo: p,
        operativos: sueldosMes + proveedoresMes,
        comerciales,
        financieros,
        ganancias: gan,
        total: sueldosMes + proveedoresMes + comerciales + financieros + gan,
        categorias,
        sueldos: sueldosMes,
        impuestos: impuestosMes,
        sueldosNeto: sueldosNetoMap.get(p) ?? 0,
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
  const [ingresos, egresos] = await Promise.all([
    fetchIngresos(),
    fetchEgresos(),
  ]);

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

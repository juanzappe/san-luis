/**
 * Queries para el dashboard Home — Resumen Ejecutivo.
 * Usa el cliente Supabase (REST) del lado del cliente.
 */
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface MonthRow {
  periodo: string; // YYYY-MM
  ingresos: number;
  egresosOp: number; // proveedores (factura_recibida neto)
  sueldos: number; // liquidacion_sueldo sueldo_neto (devengado)
  comerciales: number; // all pago_impuesto (incl ganancias, excl IVA)
  financieros: number; // comisiones bancarias
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

/** Agrupa un array por una key y suma un campo numérico. */
function sumBy<T>(rows: T[], keyFn: (r: T) => string, valFn: (r: T) => number) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r);
    map.set(k, (map.get(k) ?? 0) + valFn(r));
  }
  return map;
}

/**
 * Fetch paginado para superar el límite de 1000 filas de Supabase REST.
 * Soporta un filtro eq opcional.
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

// ---------------------------------------------------------------------------
// Fetch ingresos mensuales:
//   factura_emitida PV=6 (Servicios) + venta (Mostrador/Restobar)
//   Usa imp_neto_gravado_total para facturas, monto_total para ventas.
// ---------------------------------------------------------------------------
async function fetchIngresosMensuales(): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc("get_ingresos_mensual");
  if (error) throw error;
  const map = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ periodo: string; mostrador: number; restobar: number; servicios: number }>) {
    map.set(r.periodo, (Number(r.mostrador) || 0) + (Number(r.restobar) || 0) + (Number(r.servicios) || 0));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Egresos segmentados (4 categorías)
// ---------------------------------------------------------------------------

interface EgresosMonth {
  egresosOp: number; // proveedores only (factura_recibida neto)
  sueldos: number; // sueldo_neto with devengamiento
  comerciales: number; // all taxes incl ganancias (excl IVA)
  financieros: number; // bank fees
}

/**
 * Devengamiento: determina a qué mes acreditar un sueldo.
 * - Aguinaldo (periodo ends "-SAC"): accrue to payment month
 * - fecha_transferencia day < 20: accrue to previous month
 * - fecha_transferencia day >= 20: accrue to transfer month
 * - NULL fecha_transferencia: fall back to periodo field
 */
function accrualPeriod(r: { periodo: string; fecha_transferencia: string | null }): string {
  const isSAC = r.periodo.endsWith("-SAC");

  if (!r.fecha_transferencia) return r.periodo.slice(0, 7);

  const ft = new Date(r.fecha_transferencia + "T12:00:00");
  const day = ft.getDate();
  const ftMonth = r.fecha_transferencia.slice(0, 7);

  if (isSAC) return ftMonth; // Aguinaldo: accrue to payment month

  if (day < 20) {
    // Paid before 20th: accrue to PREVIOUS month
    const y = ft.getFullYear();
    const m = ft.getMonth(); // 0-indexed
    return m === 0
      ? `${y - 1}-12`
      : `${y}-${String(m).padStart(2, "0")}`;
  }
  return ftMonth;
}

async function fetchEgresosSegmentados(): Promise<Map<string, EgresosMonth>> {
  // 1) Sueldos with devengamiento
  const sueldosData = await fetchAllRows<{
    periodo: string;
    sueldo_neto: number;
    fecha_transferencia: string | null;
  }>(
    "liquidacion_sueldo",
    "periodo, sueldo_neto, fecha_transferencia",
  );

  const sueldosMap = new Map<string, number>();
  for (const r of sueldosData) {
    const p = accrualPeriod(r);
    sueldosMap.set(p, (sueldosMap.get(p) ?? 0) + (Number(r.sueldo_neto) || 0));
  }

  // 2) Proveedores (factura_recibida neto) → egresosOp (with NC sign)
  const provData = await fetchAllRows<{ fecha_emision: string; imp_neto_gravado_total: number; tipo_comprobante: number | null }>(
    "factura_recibida",
    "fecha_emision, imp_neto_gravado_total, tipo_comprobante",
  );

  const provMap = sumBy(
    provData,
    (r) => (r.fecha_emision as string).slice(0, 7),
    (r) => {
      const raw = Number(r.imp_neto_gravado_total) || 0;
      return [3, 8, 203].includes(Number(r.tipo_comprobante)) ? -raw : raw;
    },
  );

  // 3) Impuestos — ALL pago_impuesto (incl ganancias, excl IVA which isn't in this table)
  const pagos = await fetchAllRows<{ fecha_pago: string; monto: number }>(
    "pago_impuesto",
    "fecha_pago, monto",
  );

  const taxMap = new Map<string, number>();
  for (const pago of pagos) {
    const p = (pago.fecha_pago as string).slice(0, 7);
    taxMap.set(p, (taxMap.get(p) ?? 0) + (Number(pago.monto) || 0));
  }

  // 4) Costos financieros (comisiones, intereses, etc. en movimientos bancarios)
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
  for (const mp of [sueldosMap, provMap, taxMap, financierosMap]) {
    mp.forEach((_, k) => allP.add(k));
  }

  const result = new Map<string, EgresosMonth>();
  for (const p of Array.from(allP)) {
    result.set(p, {
      egresosOp: provMap.get(p) ?? 0,
      sueldos: sueldosMap.get(p) ?? 0,
      comerciales: taxMap.get(p) ?? 0,
      financieros: financierosMap.get(p) ?? 0,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fetch ventas por fuente + servicios de factura_emitida PV=6
// ---------------------------------------------------------------------------
async function fetchVentasPorFuente(): Promise<IncomeBySource[]> {
  const { data, error } = await supabase.rpc("get_ingresos_mensual");
  if (error) throw error;
  return ((data ?? []) as Array<{ periodo: string; mostrador: number; restobar: number; servicios: number }>)
    .map((r) => ({
      periodo: r.periodo,
      mostrador: Number(r.mostrador) || 0,
      restobar: Number(r.restobar) || 0,
      servicios: Number(r.servicios) || 0,
    }))
    .sort((a, b) => a.periodo.localeCompare(b.periodo));
}

// ---------------------------------------------------------------------------
// Consolidar datos del dashboard
// ---------------------------------------------------------------------------
export interface DashboardData {
  kpis: KpiData | null;
  monthly: MonthRow[];
  incomeBySource: IncomeBySource[];
  hasData: boolean;
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const [ingresos, egresosMap, incomeBySource] = await Promise.all([
    fetchIngresosMensuales(),
    fetchEgresosSegmentados(),
    fetchVentasPorFuente(),
  ]);

  // Juntar todos los períodos
  const allPeriodos = new Set<string>();
  ingresos.forEach((_, k) => allPeriodos.add(k));
  egresosMap.forEach((_, k) => allPeriodos.add(k));

  if (allPeriodos.size === 0) {
    return { kpis: null, monthly: [], incomeBySource: [], hasData: false };
  }

  const sorted = Array.from(allPeriodos).sort();

  // Construir tabla mensual
  const monthly: MonthRow[] = sorted.map((p) => {
    const ing = ingresos.get(p) ?? 0;
    const eg = egresosMap.get(p) ?? { egresosOp: 0, sueldos: 0, comerciales: 0, financieros: 0 };
    const egTotal = eg.egresosOp + eg.sueldos + eg.comerciales + eg.financieros;
    const res = ing - egTotal;
    const margen = ing > 0 ? (res / ing) * 100 : 0;
    return {
      periodo: p,
      ingresos: ing,
      egresosOp: eg.egresosOp,
      sueldos: eg.sueldos,
      comerciales: eg.comerciales,
      financieros: eg.financieros,
      egresosTotal: egTotal,
      resultado: res,
      margen,
    };
  });

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

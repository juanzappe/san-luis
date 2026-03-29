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
  operativos: number; // sueldos + proveedores
  comerciales: number; // impuestos (no ganancias)
  financieros: number; // comisiones bancarias
  ganancias: number; // impuesto a las ganancias
  egresosTotal: number;
  resultado: number;
  margen: number; // %
}

export interface KpiData {
  ingresos: number;
  egresos: number;
  sueldos: number;
  resultado: number;
  deltaIngresos: number | null;
  deltaEgresos: number | null;
  deltaSueldos: number | null;
  deltaResultado: number | null;
  periodo: string; // "Marzo 2026"
}

export interface IncomeBySource {
  periodo: string;
  mostrador: number;
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
  const [facturas, ventas] = await Promise.all([
    fetchAllRows<{ fecha_emision: string; imp_neto_gravado_total: number }>(
      "factura_emitida",
      "fecha_emision, imp_neto_gravado_total",
      { column: "punto_venta", value: 6 },
    ),
    fetchAllRows<{ fecha: string; monto_total: number }>(
      "venta",
      "fecha, monto_total",
    ),
  ]);

  const map = new Map<string, number>();
  for (const r of facturas) {
    const p = (r.fecha_emision as string).slice(0, 7);
    map.set(p, (map.get(p) ?? 0) + (Number(r.imp_neto_gravado_total) || 0));
  }
  for (const r of ventas) {
    const p = (r.fecha as string).slice(0, 7);
    map.set(p, (map.get(p) ?? 0) + (Number(r.monto_total) || 0));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Egresos segmentados (4 categorías)
// ---------------------------------------------------------------------------

interface EgresosMonth {
  operativos: number; // sueldos + proveedores
  comerciales: number; // impuestos (no ganancias)
  financieros: number; // comisiones bancarias
  ganancias: number; // imp. a las ganancias
  sueldos: number; // solo sueldos (para KPI separado)
}

async function fetchEgresosSegmentados(): Promise<Map<string, EgresosMonth>> {
  // 1) Sueldos (costo_total_empresa si existe, fallback a sueldo_neto)
  const sueldosData = await fetchAllRows<{ periodo: string; costo_total_empresa: number | null; sueldo_neto: number }>(
    "liquidacion_sueldo",
    "periodo, costo_total_empresa, sueldo_neto",
  );

  const sueldosMap = sumBy(
    sueldosData,
    (r) => (r.periodo as string).slice(0, 7),
    (r) => Number(r.costo_total_empresa ?? r.sueldo_neto) || 0,
  );

  // Sueldos netos (for KPI display)
  const sueldosNetoMap = sumBy(
    sueldosData,
    (r) => (r.periodo as string).slice(0, 7),
    (r) => Number(r.sueldo_neto) || 0,
  );

  // 2) Proveedores (factura_recibida neto)
  const provData = await fetchAllRows<{ fecha_emision: string; imp_neto_gravado_total: number }>(
    "factura_recibida",
    "fecha_emision, imp_neto_gravado_total",
  );

  const provMap = sumBy(
    provData,
    (r) => (r.fecha_emision as string).slice(0, 7),
    (r) => Number(r.imp_neto_gravado_total) || 0,
  );

  // 3) Impuestos — pago_impuesto JOIN impuesto_obligacion para tipo
  const { data: pagos, error: e3 } = await supabase
    .from("pago_impuesto")
    .select("fecha_pago, monto, impuesto_obligacion:impuesto_obligacion_id(tipo)");
  if (e3) throw e3;

  const impComercialMap = new Map<string, number>();
  const gananciasMap = new Map<string, number>();

  if (pagos) {
    for (const pago of pagos) {
      const p = (pago.fecha_pago as string).slice(0, 7);
      const monto = Number(pago.monto) || 0;
      const oblRaw = pago.impuesto_obligacion as unknown;
      const obligacion = Array.isArray(oblRaw)
        ? (oblRaw[0] as { tipo: string } | undefined)
        : (oblRaw as { tipo: string } | null);
      const tipo = obligacion?.tipo ?? "";
      if (tipo === "ganancias") {
        gananciasMap.set(p, (gananciasMap.get(p) ?? 0) + monto);
      } else {
        impComercialMap.set(p, (impComercialMap.get(p) ?? 0) + monto);
      }
    }
  }

  // 4) Costos financieros (comisiones, intereses, etc. en movimientos bancarios)
  const { data: movBanco, error: e4 } = await supabase
    .from("movimiento_bancario")
    .select("fecha, concepto, debito");
  if (e4) throw e4;

  const financierosMap = new Map<string, number>();
  if (movBanco) {
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
  }

  // Merge all periodos
  const allP = new Set<string>();
  for (const mp of [sueldosMap, provMap, impComercialMap, gananciasMap, financierosMap]) {
    mp.forEach((_, k) => allP.add(k));
  }

  const result = new Map<string, EgresosMonth>();
  for (const p of Array.from(allP)) {
    const sueldosMes = sueldosMap.get(p) ?? 0;
    const provMes = provMap.get(p) ?? 0;
    result.set(p, {
      operativos: sueldosMes + provMes,
      comerciales: impComercialMap.get(p) ?? 0,
      financieros: financierosMap.get(p) ?? 0,
      ganancias: gananciasMap.get(p) ?? 0,
      sueldos: sueldosNetoMap.get(p) ?? 0,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fetch ventas por fuente + servicios de factura_emitida PV=6
// ---------------------------------------------------------------------------
async function fetchVentasPorFuente(): Promise<IncomeBySource[]> {
  const [ventasData, facturasServ] = await Promise.all([
    fetchAllRows<{ fecha: string; monto_total: number; fuente: string }>(
      "venta",
      "fecha, monto_total, fuente",
    ),
    fetchAllRows<{ fecha_emision: string; imp_neto_gravado_total: number }>(
      "factura_emitida",
      "fecha_emision, imp_neto_gravado_total",
      { column: "punto_venta", value: 6 },
    ),
  ]);

  const map = new Map<string, { mostrador: number; servicios: number }>();

  // POS ventas → mostrador
  for (const r of ventasData) {
    const p = (r.fecha as string).slice(0, 7);
    const entry = map.get(p) ?? { mostrador: 0, servicios: 0 };
    const monto = Number(r.monto_total) || 0;
    if (r.fuente === "pos") {
      entry.mostrador += monto;
    } else {
      entry.mostrador += monto; // non-pos ventas still go to mostrador
    }
    map.set(p, entry);
  }

  // Facturas PV=6 → servicios
  for (const r of facturasServ) {
    const p = (r.fecha_emision as string).slice(0, 7);
    const entry = map.get(p) ?? { mostrador: 0, servicios: 0 };
    entry.servicios += Number(r.imp_neto_gravado_total) || 0;
    map.set(p, entry);
  }

  return Array.from(map.entries())
    .map(([periodo, v]) => ({ periodo, ...v }))
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
    const eg = egresosMap.get(p) ?? { operativos: 0, comerciales: 0, financieros: 0, ganancias: 0, sueldos: 0 };
    const egTotal = eg.operativos + eg.comerciales + eg.financieros + eg.ganancias;
    const res = ing - egTotal;
    const margen = ing > 0 ? (res / ing) * 100 : 0;
    return {
      periodo: p,
      ingresos: ing,
      operativos: eg.operativos,
      comerciales: eg.comerciales,
      financieros: eg.financieros,
      ganancias: eg.ganancias,
      egresosTotal: egTotal,
      resultado: res,
      margen,
    };
  });

  // KPIs del último mes
  const last = monthly[monthly.length - 1];
  const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
  const lastEg = egresosMap.get(last.periodo);
  const prevRow = prev;

  const kpis: KpiData = {
    ingresos: last.ingresos,
    egresos: last.egresosTotal,
    sueldos: lastEg?.sueldos ?? 0,
    resultado: last.resultado,
    deltaIngresos: prev ? pctDelta(last.ingresos, prev.ingresos) : null,
    deltaEgresos: prev ? pctDelta(last.egresosTotal, prevRow!.egresosTotal) : null,
    deltaSueldos: prev && lastEg
      ? pctDelta(lastEg.sueldos, egresosMap.get(prev.periodo)?.sueldos ?? 0)
      : null,
    deltaResultado: prev ? pctDelta(last.resultado, prev.resultado) : null,
    periodo: periodoLabel(last.periodo),
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

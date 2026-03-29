/**
 * Queries for the Personal module.
 * Nómina, Empleados, Cargas sociales.
 */
import { supabase } from "./supabase";
import { formatARS, formatPct, pctDelta, periodoLabel, shortLabel } from "./economic-queries";

export { formatARS, formatPct, pctDelta, periodoLabel, shortLabel };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addToMap(map: Map<string, number>, key: string, val: number) {
  map.set(key, (map.get(key) ?? 0) + val);
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
 * - SAC (aguinaldo, periodo ends "-SAC"): accrue to payment month
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

/**
 * Parse periodo from pago_impuesto observaciones field.
 * Format: "Impuesto: 301 ... | Período: 20260200 | ..."
 * Returns "2026-02" or null.
 */
function parsePeriodoFromObs(obs: string | null): string | null {
  if (!obs) return null;
  const match = obs.match(/Per[ií]odo:\s*(\d{6})/);
  if (!match) return null;
  const raw = match[1]; // "202602"
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
}

// ---------------------------------------------------------------------------
// 1. Nómina — Monthly payroll evolution
// ---------------------------------------------------------------------------

export interface NominaRow {
  periodo: string;
  cantEmpleados: number;
  sueldosNetos: number;
  cargasSociales: number;
  costoTotal: number;
  costoPromedio: number;
  ingresos: number;
  pctSobreIngresos: number;
}

export async function fetchNomina(): Promise<NominaRow[]> {
  const [liqData, pagosData, factData, ventaData] = await Promise.all([
    fetchAllRows<{
      periodo: string;
      sueldo_neto: number;
      empleado_id: number;
      fecha_transferencia: string | null;
    }>("liquidacion_sueldo", "periodo, sueldo_neto, empleado_id, fecha_transferencia"),
    fetchAllRows<{ monto: number; observaciones: string | null; formulario: string | null }>(
      "pago_impuesto",
      "monto, observaciones, formulario",
    ),
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

  // Sueldos netos with devengamiento + count distinct employees (excl SAC)
  const sueldosMap = new Map<string, number>();
  const empMap = new Map<string, Set<number>>();
  for (const r of liqData) {
    const p = accrualPeriod(r);
    addToMap(sueldosMap, p, Number(r.sueldo_neto) || 0);
    // Count employees only from regular payslips (exclude SAC/aguinaldo)
    if (!r.periodo.endsWith("-SAC")) {
      if (!empMap.has(p)) empMap.set(p, new Set());
      empMap.get(p)!.add(Number(r.empleado_id));
    }
  }

  // Cargas sociales: formulario = '1931' only, grouped by parsed periodo
  const cargasMap = new Map<string, number>();
  for (const r of pagosData) {
    if (r.formulario !== "1931") continue;
    const p = parsePeriodoFromObs(r.observaciones);
    if (!p) continue;
    addToMap(cargasMap, p, Number(r.monto) || 0);
  }

  // Ingresos: factura_emitida PV=6 neto + venta monto_total
  const ingresosMap = new Map<string, number>();
  for (const r of factData) {
    const p = (r.fecha_emision as string).slice(0, 7);
    addToMap(ingresosMap, p, Number(r.imp_neto_gravado_total) || 0);
  }
  for (const r of ventaData) {
    const p = (r.fecha as string).slice(0, 7);
    addToMap(ingresosMap, p, Number(r.monto_total) || 0);
  }

  // Merge all periodos
  const allP = new Set<string>();
  sueldosMap.forEach((_, k) => allP.add(k));
  cargasMap.forEach((_, k) => allP.add(k));

  return Array.from(allP)
    .sort()
    .map((p) => {
      const sueldosNetos = sueldosMap.get(p) ?? 0;
      const cargasSociales = cargasMap.get(p) ?? 0;
      const costoTotal = sueldosNetos + cargasSociales;
      const cantEmpleados = empMap.get(p)?.size ?? 0;
      const costoPromedio = cantEmpleados > 0 ? costoTotal / cantEmpleados : 0;
      const ingresos = ingresosMap.get(p) ?? 0;
      const pctSobreIngresos = ingresos > 0 ? (costoTotal / ingresos) * 100 : 0;
      return { periodo: p, cantEmpleados, sueldosNetos, cargasSociales, costoTotal, costoPromedio, ingresos, pctSobreIngresos };
    });
}

// ---------------------------------------------------------------------------
// 2. Empleados — Employee detail + salary history
// ---------------------------------------------------------------------------

export interface EmpleadoRow {
  id: number;
  nombre: string;
  cuil: string;
  puesto: string;
  fechaIngreso: string | null;
  activo: boolean;
  ultimoSueldo: number;
  antiguedad: string;
}

export interface EmpleadoLiquidacion {
  periodo: string;
  sueldoNeto: number;
  variacionPct: number | null;
}

export interface EmpleadoDetalle {
  empleado: EmpleadoRow;
  liquidaciones: EmpleadoLiquidacion[];
}

function calcAntiguedad(fechaIngreso: string | null): string {
  if (!fechaIngreso) return "—";
  const from = new Date(fechaIngreso);
  const now = new Date();
  let years = now.getFullYear() - from.getFullYear();
  let months = now.getMonth() - from.getMonth();
  if (months < 0) { years--; months += 12; }
  if (years > 0) return `${years}a ${months}m`;
  return `${months}m`;
}

export async function fetchEmpleados(): Promise<EmpleadoRow[]> {
  const [empData, liqData] = await Promise.all([
    fetchAllRows<{
      id: number; nombre: string; cuil: string | null;
      puesto: string | null; fecha_ingreso: string | null; activo: boolean;
    }>("empleado", "id, nombre, cuil, puesto, fecha_ingreso, activo"),
    fetchAllRows<{ empleado_id: number; periodo: string; sueldo_neto: number }>(
      "liquidacion_sueldo", "empleado_id, periodo, sueldo_neto",
    ),
  ]);

  // Find latest liquidacion per employee (excluding SAC for period comparison)
  const lastSueldo = new Map<number, number>();
  const lastPeriodo = new Map<number, string>();
  for (const r of liqData) {
    const eid = Number(r.empleado_id);
    const p = (r.periodo as string).slice(0, 7);
    if (!lastPeriodo.has(eid) || p > lastPeriodo.get(eid)!) {
      lastPeriodo.set(eid, p);
      lastSueldo.set(eid, Number(r.sueldo_neto) || 0);
    }
  }

  // Determine "active" = has a payslip in the last 3 months
  const now = new Date();
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const cutoff = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}`;

  return empData.map((e) => {
    const lp = lastPeriodo.get(e.id as number);
    const isActive = lp ? lp >= cutoff : false;
    return {
      id: e.id as number,
      nombre: (e.nombre ?? "") as string,
      cuil: (e.cuil ?? "") as string,
      puesto: (e.puesto ?? "") as string,
      fechaIngreso: (e.fecha_ingreso as string) ?? null,
      activo: isActive,
      ultimoSueldo: lastSueldo.get(e.id as number) ?? 0,
      antiguedad: calcAntiguedad((e.fecha_ingreso as string) ?? null),
    };
  });
}

export async function fetchEmpleadoDetalle(empleadoId: number): Promise<EmpleadoDetalle | null> {
  const [empRes, liqRes] = await Promise.all([
    supabase.from("empleado").select("id, nombre, cuil, puesto, fecha_ingreso, activo").eq("id", empleadoId).single(),
    supabase.from("liquidacion_sueldo").select("periodo, sueldo_neto").eq("empleado_id", empleadoId).order("periodo", { ascending: true }),
  ]);

  if (empRes.error || !empRes.data) return null;
  if (liqRes.error) throw liqRes.error;

  const e = empRes.data;
  const empleado: EmpleadoRow = {
    id: e.id as number,
    nombre: (e.nombre ?? "") as string,
    cuil: (e.cuil ?? "") as string,
    puesto: (e.puesto ?? "") as string,
    fechaIngreso: (e.fecha_ingreso as string) ?? null,
    activo: e.activo as boolean,
    ultimoSueldo: 0,
    antiguedad: calcAntiguedad((e.fecha_ingreso as string) ?? null),
  };

  const liquidaciones: EmpleadoLiquidacion[] = (liqRes.data ?? []).map((r, i, arr) => {
    const sueldo = Number(r.sueldo_neto) || 0;
    const prev = i > 0 ? Number(arr[i - 1].sueldo_neto) || 0 : null;
    return {
      periodo: (r.periodo as string).slice(0, 7),
      sueldoNeto: sueldo,
      variacionPct: prev !== null && prev > 0 ? ((sueldo - prev) / prev) * 100 : null,
    };
  });

  if (liquidaciones.length > 0) {
    empleado.ultimoSueldo = liquidaciones[liquidaciones.length - 1].sueldoNeto;
  }

  return { empleado, liquidaciones };
}

// ---------------------------------------------------------------------------
// 3. Cargas Sociales — Social security payments
// ---------------------------------------------------------------------------

export interface CargaSocialRow {
  id: number;
  periodo: string;
  concepto: string;
  monto: number;
  fechaPago: string;
}

export interface CargaSocialMensual {
  periodo: string;
  total: number;
  sueldosNetos: number;
  ratio: number;
}

export async function fetchCargasSociales(): Promise<{
  pagos: CargaSocialRow[];
  mensual: CargaSocialMensual[];
}> {
  const [pagosData, liqData] = await Promise.all([
    fetchAllRows<{
      id: number;
      fecha_pago: string;
      monto: number;
      observaciones: string | null;
      formulario: string | null;
    }>("pago_impuesto", "id, fecha_pago, monto, observaciones, formulario"),
    fetchAllRows<{
      periodo: string;
      sueldo_neto: number;
      fecha_transferencia: string | null;
    }>("liquidacion_sueldo", "periodo, sueldo_neto, fecha_transferencia"),
  ]);

  // Filter formulario = '1931' only, group by parsed periodo from observaciones
  const pagos: CargaSocialRow[] = [];
  const mensualMap = new Map<string, number>();

  for (const r of pagosData) {
    if (r.formulario !== "1931") continue;
    const p = parsePeriodoFromObs(r.observaciones);
    if (!p) continue;
    const monto = Number(r.monto) || 0;
    pagos.push({
      id: r.id as number,
      periodo: p,
      concepto: r.observaciones ?? "F1931",
      monto,
      fechaPago: r.fecha_pago as string,
    });
    addToMap(mensualMap, p, monto);
  }

  // Sueldos netos with devengamiento for ratio
  const sueldosMap = new Map<string, number>();
  for (const r of liqData) {
    const p = accrualPeriod(r);
    addToMap(sueldosMap, p, Number(r.sueldo_neto) || 0);
  }

  const allP = new Set<string>();
  mensualMap.forEach((_, k) => allP.add(k));
  sueldosMap.forEach((_, k) => allP.add(k));

  const mensual: CargaSocialMensual[] = Array.from(allP)
    .sort()
    .map((p) => {
      const total = mensualMap.get(p) ?? 0;
      const sueldosNetos = sueldosMap.get(p) ?? 0;
      const ratio = sueldosNetos > 0 ? (total / sueldosNetos) * 100 : 0;
      return { periodo: p, total, sueldosNetos, ratio };
    });

  return { pagos: pagos.sort((a, b) => b.fechaPago.localeCompare(a.fechaPago)), mensual };
}

// ---------------------------------------------------------------------------
// 4. Organigrama — Simple employee list by category
// ---------------------------------------------------------------------------

export interface OrgEmpleado {
  id: number;
  nombre: string;
  puesto: string;
  activo: boolean;
}

export async function fetchEmpleadosByPuesto(): Promise<Map<string, OrgEmpleado[]>> {
  const { data, error } = await supabase
    .from("empleado")
    .select("id, nombre, puesto, activo")
    .eq("activo", true)
    .order("nombre", { ascending: true });

  if (error) throw error;

  const map = new Map<string, OrgEmpleado[]>();
  for (const r of data ?? []) {
    const puesto = (r.puesto as string) || "Sin categoría";
    if (!map.has(puesto)) map.set(puesto, []);
    map.get(puesto)!.push({
      id: r.id as number,
      nombre: (r.nombre ?? "") as string,
      puesto,
      activo: r.activo as boolean,
    });
  }
  return map;
}

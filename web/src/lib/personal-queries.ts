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
  const [liqRes, pagosRes, factRes, ventaRes] = await Promise.all([
    supabase.from("liquidacion_sueldo").select("periodo, sueldo_neto, empleado_id"),
    supabase.from("pago_impuesto").select("fecha_pago, monto, observaciones"),
    supabase.from("factura_emitida").select("fecha_emision, imp_neto_gravado_total"),
    supabase.from("venta").select("fecha, monto_total"),
  ]);

  if (liqRes.error) throw liqRes.error;
  if (pagosRes.error) throw pagosRes.error;
  if (factRes.error) throw factRes.error;
  if (ventaRes.error) throw ventaRes.error;

  // Sueldos netos + count distinct employees per period
  const sueldosMap = new Map<string, number>();
  const empMap = new Map<string, Set<number>>();
  for (const r of liqRes.data ?? []) {
    const p = (r.periodo as string).slice(0, 7);
    addToMap(sueldosMap, p, Number(r.sueldo_neto) || 0);
    if (!empMap.has(p)) empMap.set(p, new Set());
    empMap.get(p)!.add(Number(r.empleado_id));
  }

  // Cargas sociales: pago_impuesto where observaciones matches F931/SICOSS
  const cargasMap = new Map<string, number>();
  for (const r of pagosRes.data ?? []) {
    const obs = ((r.observaciones as string) ?? "").toLowerCase();
    if (obs.includes("931") || obs.includes("sicoss") || obs.includes("contribucion")) {
      const p = (r.fecha_pago as string).slice(0, 7);
      addToMap(cargasMap, p, Number(r.monto) || 0);
    }
  }

  // Ingresos: factura_emitida neto + venta monto_total
  const ingresosMap = new Map<string, number>();
  for (const r of factRes.data ?? []) {
    const p = (r.fecha_emision as string).slice(0, 7);
    addToMap(ingresosMap, p, Number(r.imp_neto_gravado_total) || 0);
  }
  for (const r of ventaRes.data ?? []) {
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
  const [empRes, liqRes] = await Promise.all([
    supabase.from("empleado").select("id, nombre, cuil, puesto, fecha_ingreso, activo"),
    supabase.from("liquidacion_sueldo").select("empleado_id, periodo, sueldo_neto"),
  ]);

  if (empRes.error) throw empRes.error;
  if (liqRes.error) throw liqRes.error;

  // Find latest liquidacion per employee
  const lastSueldo = new Map<number, number>();
  const lastPeriodo = new Map<number, string>();
  for (const r of liqRes.data ?? []) {
    const eid = Number(r.empleado_id);
    const p = (r.periodo as string).slice(0, 7);
    if (!lastPeriodo.has(eid) || p > lastPeriodo.get(eid)!) {
      lastPeriodo.set(eid, p);
      lastSueldo.set(eid, Number(r.sueldo_neto) || 0);
    }
  }

  return (empRes.data ?? []).map((e) => ({
    id: e.id as number,
    nombre: (e.nombre ?? "") as string,
    cuil: (e.cuil ?? "") as string,
    puesto: (e.puesto ?? "") as string,
    fechaIngreso: (e.fecha_ingreso as string) ?? null,
    activo: e.activo as boolean,
    ultimoSueldo: lastSueldo.get(e.id as number) ?? 0,
    antiguedad: calcAntiguedad((e.fecha_ingreso as string) ?? null),
  }));
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
  const [pagosRes, liqRes] = await Promise.all([
    supabase.from("pago_impuesto").select("id, fecha_pago, monto, observaciones"),
    supabase.from("liquidacion_sueldo").select("periodo, sueldo_neto"),
  ]);

  if (pagosRes.error) throw pagosRes.error;
  if (liqRes.error) throw liqRes.error;

  // Filter F931/SICOSS payments
  const pagos: CargaSocialRow[] = [];
  const mensualMap = new Map<string, number>();

  for (const r of pagosRes.data ?? []) {
    const obs = ((r.observaciones as string) ?? "").toLowerCase();
    if (obs.includes("931") || obs.includes("sicoss") || obs.includes("contribucion")) {
      const p = (r.fecha_pago as string).slice(0, 7);
      const monto = Number(r.monto) || 0;
      pagos.push({
        id: r.id as number,
        periodo: p,
        concepto: (r.observaciones as string) ?? "F931/SICOSS",
        monto,
        fechaPago: r.fecha_pago as string,
      });
      addToMap(mensualMap, p, monto);
    }
  }

  // Sueldos netos for ratio
  const sueldosMap = new Map<string, number>();
  for (const r of liqRes.data ?? []) {
    const p = (r.periodo as string).slice(0, 7);
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

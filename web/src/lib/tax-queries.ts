/**
 * Queries for the Impuestos module.
 * Resumen Fiscal, Posición IVA, Historial de Pagos, Calendario.
 */
import { supabase } from "./supabase";
import { fetchWithRetry } from "./fetchWithRetry";
import { formatARS, formatPct, pctDelta, periodoLabel, shortLabel, fetchResultado, type ResultadoRow } from "./economic-queries";

export { formatARS, formatPct, pctDelta, periodoLabel, shortLabel };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addToMap(map: Map<string, number>, key: string, val: number) {
  map.set(key, (map.get(key) ?? 0) + val);
}

// ---------------------------------------------------------------------------
// Impuesto al Cheque — RPC get_cheque_mensual (LEY 25413 debits, server-side)
// ---------------------------------------------------------------------------

async function fetchChequeMensual(): Promise<Array<{ periodo: string; importe_cheque: number }>> {
  const { data, error } = await supabase.rpc("get_cheque_mensual");
  if (error) throw error;
  // RPC returns up to 2 rows per month (banco + MP via UNION ALL) — aggregate here
  // Handle both possible column names: importe_cheque (migration 017) or cheque
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const map = new Map<string, number>();
  for (const row of rows) {
    const periodo = String(row.periodo ?? "");
    const amount = Number(row.importe_cheque ?? row.cheque ?? 0) || 0;
    if (periodo) addToMap(map, periodo, amount);
  }
  return Array.from(map.entries()).map(([periodo, importe_cheque]) => ({ periodo, importe_cheque }));
}

// Labels for tipo_impuesto_enum
const TIPO_LABELS: Record<string, string> = {
  iva: "IVA",
  ganancias: "Ganancias",
  sicore: "Ret./SICORE",
  cheque: "Imp. al Cheque",
  iibb: "Ingresos Brutos",
  tasa_seguridad_higiene: "Seg. e Higiene",
  tasa_publicidad_propaganda: "Publicidad",
  tasa_ocupacion_espacio_publico: "Ocupación Esp. Público",
  debitos_creditos: "Déb./Créd. Bancarios",
};

export function tipoLabel(tipo: string): string {
  return TIPO_LABELS[tipo] ?? tipo;
}

const FUENTE_LABELS: Record<string, string> = {
  arca: "Nacional (ARCA)",
  arba: "Provincial (ARBA)",
  municipio: "Municipal",
};

export function fuenteLabel(fuente: string): string {
  return FUENTE_LABELS[fuente] ?? fuente;
}

// Jurisdiction from tipo
function jurisdiccionFromTipo(tipo: string): string {
  if (tipo === "iva" || tipo === "ganancias" || tipo === "debitos_creditos" || tipo === "cheque" || tipo === "sicore") return "arca";
  if (tipo === "iibb") return "arba";
  return "municipio";
}

// ---------------------------------------------------------------------------
// 1. Resumen Fiscal
// ---------------------------------------------------------------------------

export interface ResumenMensualRow {
  periodo: string;
  ivaNeto: number;
  gananciasEst: number;
  sicore: number;
  cheque: number;
  iibb: number;
  segHigiene: number;
  publicidad: number;
  espacioPublico: number;
  total: number;
  ingresos: number;
  presionFiscal: number | null;
}

export interface ProximoVencimiento {
  fecha: string;
  impuesto: string;
  monto: number | null;
}

export interface ResumenFiscalData {
  mensual: ResumenMensualRow[];
  distribucionJurisdiccion: { name: string; value: number }[];
  proximoVto: ProximoVencimiento | null;
  periodoActual: string | null;
}

export async function fetchResumenFiscal(): Promise<ResumenFiscalData> {
  // Batch 1: light queries (free up connections before heavy ones)
  const [obligaciones, pagos, chequeRows] = await Promise.all([
    fetchWithRetry(async () => {
      const res = await supabase.rpc("get_obligaciones_resumen");
      if (res.error) throw res.error;
      return (res.data ?? []) as Array<{
        id: number; tipo: string; periodo: string; fuente: string;
        fecha_vencimiento: string | null; monto_determinado: number;
        compensaciones_recibidas: number; compensaciones_enviadas: number; estado: string;
      }>;
    }),
    fetchWithRetry(async () => {
      const res = await supabase.rpc("get_pagos_impuestos");
      if (res.error) throw res.error;
      return (res.data ?? []) as Array<{
        id: number; fecha_pago: string; monto: number; medio_pago: string;
        numero_vep: string; formulario: string; observaciones: string;
        obligacion_tipo: string; obligacion_periodo: string; obligacion_fuente: string;
      }>;
    }),
    fetchChequeMensual(),
  ]);

  // Batch 2: heavy queries (max 3 concurrent: iva + ingresos + egresos via fetchResultado)
  const [ivaMensualRows, resultadoData] = await Promise.all([
    fetchWithRetry(async () => {
      const res = await supabase.rpc("get_iva_ingresos_mensual");
      if (res.error) throw res.error;
      return (res.data ?? []) as Array<{
        periodo: string; iva_debito: number; iva_credito: number; ingresos: number;
      }>;
    }),
    fetchResultado() as Promise<ResultadoRow[]>,
  ]);

  // ---------------------------------------------------------------------------
  // Aggregate: tipo → month → sum
  // ---------------------------------------------------------------------------
  const tipoMonthMap = new Map<string, Map<string, number>>();
  const jurisdiccionTotal = new Map<string, number>();

  const addTipo = (tipo: string, month: string, monto: number, jurisdiccion: string) => {
    if (!tipoMonthMap.has(tipo)) tipoMonthMap.set(tipo, new Map());
    addToMap(tipoMonthMap.get(tipo)!, month, monto);
    addToMap(jurisdiccionTotal, jurisdiccion, monto);
  };

  // --- A) IVA — Posición neta from RPC (server-side aggregation) ---
  // Group by periodo (RPC returns one row per table per month via UNION ALL)
  const ivaDebitoMap = new Map<string, number>();
  const ivaCreditoMap = new Map<string, number>();
  const ingresosMap = new Map<string, number>();
  for (const row of ivaMensualRows) {
    addToMap(ivaDebitoMap, row.periodo, Number(row.iva_debito) || 0);
    addToMap(ivaCreditoMap, row.periodo, Number(row.iva_credito) || 0);
    addToMap(ingresosMap, row.periodo, Number(row.ingresos) || 0);
  }
  // Merge IVA neto into tipoMonthMap
  const allIvaPeriods = new Set<string>();
  ivaDebitoMap.forEach((_, k) => allIvaPeriods.add(k));
  ivaCreditoMap.forEach((_, k) => allIvaPeriods.add(k));
  Array.from(allIvaPeriods).forEach((p) => {
    const neto = (ivaDebitoMap.get(p) ?? 0) - (ivaCreditoMap.get(p) ?? 0);
    if (neto > 0) addTipo("ivaNeto", p, neto, "arca");
  });

  // --- B) Ganancias — Estimated 35% of positive resultado, capped ---
  const resultados = resultadoData as ResultadoRow[];
  const resultadoMap = new Map<string, ResultadoRow>(resultados.map((r) => [r.periodo, r]));
  for (const [p, r] of Array.from(resultadoMap.entries())) {
    if (r.resultadoAntesGanancias > 0) {
      let gananciasEst = r.resultadoAntesGanancias * 0.35;
      // Cap: if resultado > 50% of ingresos, limit to 10% of ingresos
      if (r.ingresos > 0 && r.resultadoAntesGanancias > r.ingresos * 0.5) {
        gananciasEst = Math.min(gananciasEst, r.ingresos * 0.10);
      }
      addTipo("gananciasEst", p, gananciasEst, "arca");
    }
  }

  // --- C) Impuesto al Cheque — actual LEY 25413 debits from bank + MP ---
  const chequeMap = new Map<string, number>();
  for (const row of chequeRows) {
    addToMap(chequeMap, row.periodo, Number(row.importe_cheque) || 0);
  }
  chequeMap.forEach((amount, month) => {
    if (amount > 0) addTipo("cheque", month, amount, "arca");
  });

  // --- D) SICORE — from pago_impuesto with periodo parsing ---
  for (const p of pagos) {
    const obs = (p.observaciones ?? "") as string;
    const monto = Number(p.monto) || 0;
    if (!obs.includes("217 - SICORE")) continue;

    let month: string;
    const periodoMatch = obs.match(/Per[ií]odo:\s*(\d{4})(\d{2})/);
    if (periodoMatch) {
      const [, yyyy, mm] = periodoMatch;
      if (mm === "00") {
        month = (p.fecha_pago as string).slice(0, 7);
      } else {
        month = `${yyyy}-${mm}`;
      }
    } else {
      month = (p.fecha_pago as string).slice(0, 7);
    }

    addTipo("sicore", month, monto, "arca");
  }

  // --- E) IIBB from impuesto_obligacion ---
  for (const o of obligaciones) {
    if (o.tipo !== "iibb") continue;
    const month = (o.periodo ?? "") as string;
    if (!month) continue;
    const amount = Math.max(
      Number(o.monto_determinado) || 0,
      Number(o.compensaciones_recibidas) || 0,
      Number(o.compensaciones_enviadas) || 0,
    );
    if (amount > 0) addTipo("iibb", month, amount, "arba");
  }

  // --- F) Municipal taxes from impuesto_obligacion (devengado, gap-fill) ---
  // Collect records per tasa type, sorted by periodo.
  // If there's a gap between consecutive records, distribute the amount
  // evenly across all months in the gap (the record covers multiple months).
  const municipalMap: Record<string, string> = {
    tasa_seguridad_higiene: "segHigiene",
    tasa_publicidad_propaganda: "publicidad",
    tasa_ocupacion_espacio_publico: "espacioPublico",
  };
  const municipalByTipo = new Map<string, Array<{ periodo: string; amount: number }>>();
  for (const o of obligaciones) {
    const tipoStr = o.tipo as string;
    if (!municipalMap[tipoStr]) continue;
    const periodo = (o.periodo as string) ?? "";
    if (!periodo) continue;
    const amount = Number(o.monto_determinado) || 0;
    if (amount <= 0) continue;
    if (!municipalByTipo.has(tipoStr)) municipalByTipo.set(tipoStr, []);
    municipalByTipo.get(tipoStr)!.push({ periodo, amount });
  }

  // Helper: advance YYYY-MM by n months
  const addMonths = (ym: string, n: number): string => {
    let y = parseInt(ym.slice(0, 4));
    let m = parseInt(ym.slice(5, 7)) + n;
    while (m > 12) { y++; m -= 12; }
    while (m < 1) { y--; m += 12; }
    return `${y}-${String(m).padStart(2, "0")}`;
  };

  // Helper: months between two YYYY-MM strings (inclusive of start, exclusive of end)
  const monthsBetween = (a: string, b: string): number => {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return (by - ay) * 12 + (bm - am);
  };

  for (const [tipoStr, records] of Array.from(municipalByTipo.entries())) {
    const mapped = municipalMap[tipoStr];
    records.sort((a, b) => a.periodo.localeCompare(b.periodo));

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      // Determine how many months this record covers
      const nextPeriodo = i + 1 < records.length ? records[i + 1].periodo : null;
      const span = nextPeriodo ? monthsBetween(rec.periodo, nextPeriodo) : 1;
      const monthCount = Math.max(span, 1);
      const perMonth = rec.amount / monthCount;

      for (let j = 0; j < monthCount; j++) {
        const month = addMonths(rec.periodo, j);
        addTipo(mapped, month, perMonth, "municipio");
      }
    }
  }

  // (Ingresos already populated from RPC in section A above)

  // ---------------------------------------------------------------------------
  // Build monthly rows
  // ---------------------------------------------------------------------------
  const allP = new Set<string>();
  tipoMonthMap.forEach((m) => m.forEach((_, k) => allP.add(k)));
  ingresosMap.forEach((_, k) => allP.add(k));

  const mensual: ResumenMensualRow[] = Array.from(allP).sort().map((p) => {
    const get = (tipo: string) => tipoMonthMap.get(tipo)?.get(p) ?? 0;
    const ivaNeto = get("ivaNeto");
    const gananciasEst = get("gananciasEst");
    const sicore = get("sicore");
    const cheque = get("cheque");
    const iibb = get("iibb");
    const segHigiene = get("segHigiene");
    const publicidad = get("publicidad");
    const espacioPublico = get("espacioPublico");
    const total = ivaNeto + gananciasEst + sicore + cheque + iibb + segHigiene + publicidad + espacioPublico;
    const ingresos = ingresosMap.get(p) ?? 0;
    const presionFiscal = ingresos > 0 ? (total / ingresos) * 100 : null;
    return { periodo: p, ivaNeto, gananciasEst, sicore, cheque, iibb, segHigiene, publicidad, espacioPublico, total, ingresos, presionFiscal };
  });

  // ---------------------------------------------------------------------------
  // Período actual: last month with tax data
  // ---------------------------------------------------------------------------
  let periodoActual: string | null = null;
  for (let i = mensual.length - 1; i >= 0; i--) {
    if (mensual[i].total > 0) {
      periodoActual = periodoLabel(mensual[i].periodo);
      break;
    }
  }

  // ---------------------------------------------------------------------------
  // Jurisdicción donut
  // ---------------------------------------------------------------------------
  const distribucionJurisdiccion = Array.from(jurisdiccionTotal.entries())
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: fuenteLabel(k), value: v }))
    .sort((a, b) => b.value - a.value);

  // ---------------------------------------------------------------------------
  // Próximo vencimiento
  // ---------------------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const pendientes = obligaciones
    .filter((o) => (o.estado === "pendiente" || o.estado === "vencido") && o.fecha_vencimiento)
    .sort((a, b) => (a.fecha_vencimiento as string).localeCompare(b.fecha_vencimiento as string));

  const futuro = pendientes.find((o) => (o.fecha_vencimiento as string) >= today);
  const proximoVto: ProximoVencimiento | null = futuro
    ? { fecha: futuro.fecha_vencimiento as string, impuesto: tipoLabel(futuro.tipo as string), monto: Number(futuro.monto_determinado) || null }
    : pendientes.length > 0
      ? { fecha: pendientes[pendientes.length - 1].fecha_vencimiento as string, impuesto: tipoLabel(pendientes[pendientes.length - 1].tipo as string), monto: Number(pendientes[pendientes.length - 1].monto_determinado) || null }
      : null;

  return { mensual, distribucionJurisdiccion, proximoVto, periodoActual };
}

// ---------------------------------------------------------------------------
// 2. Posición de IVA
// ---------------------------------------------------------------------------

export interface IvaMensualRow {
  periodo: string;
  debito21: number;
  debito105: number;
  debitoOtros: number;
  totalDebito: number;
  credito21: number;
  credito105: number;
  creditoOtros: number;
  totalCredito: number;
  posicionNeta: number;
  retenciones: number;
  percepciones: number;
  saldoFinal: number;
}

export async function fetchPosicionIva(): Promise<IvaMensualRow[]> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_posicion_iva_mensual");
    if (res.error) throw res.error;
    return res.data;
  });

  type RpcRow = {
    periodo: string; tipo: string;
    iva_21: number; iva_10_5: number; iva_27: number;
    iva_5: number; iva_2_5: number; total_iva: number;
    otros_tributos: number;
  };
  const rows = (data ?? []) as RpcRow[];

  // Débito fiscal
  const debMap21 = new Map<string, number>();
  const debMap105 = new Map<string, number>();
  const debMapOtros = new Map<string, number>();
  const debMapTotal = new Map<string, number>();

  // Crédito fiscal
  const credMap21 = new Map<string, number>();
  const credMap105 = new Map<string, number>();
  const credMapOtros = new Map<string, number>();
  const credMapTotal = new Map<string, number>();
  const retMap = new Map<string, number>();

  for (const r of rows) {
    const p = r.periodo;
    const v21 = Number(r.iva_21) || 0;
    const v105 = Number(r.iva_10_5) || 0;
    const v27 = Number(r.iva_27) || 0;
    const v5 = Number(r.iva_5) || 0;
    const v25 = Number(r.iva_2_5) || 0;
    const otros = v27 + v5 + v25;
    const totalIva = Number(r.total_iva) || (v21 + v105 + otros);

    if (r.tipo === "debito") {
      addToMap(debMap21, p, v21);
      addToMap(debMap105, p, v105);
      addToMap(debMapOtros, p, otros);
      addToMap(debMapTotal, p, totalIva);
    } else {
      addToMap(credMap21, p, v21);
      addToMap(credMap105, p, v105);
      addToMap(credMapOtros, p, otros);
      addToMap(credMapTotal, p, totalIva);
      addToMap(retMap, p, Number(r.otros_tributos) || 0);
    }
  }

  // Merge
  const allP = new Set<string>();
  debMapTotal.forEach((_, k) => allP.add(k));
  credMapTotal.forEach((_, k) => allP.add(k));

  let saldoAcum = 0;
  return Array.from(allP).sort().map((p) => {
    const totalDebito = debMapTotal.get(p) ?? 0;
    const totalCredito = credMapTotal.get(p) ?? 0;
    const retenciones = retMap.get(p) ?? 0;
    const posicionNeta = totalDebito - totalCredito;
    saldoAcum = posicionNeta - retenciones;
    return {
      periodo: p,
      debito21: debMap21.get(p) ?? 0,
      debito105: debMap105.get(p) ?? 0,
      debitoOtros: debMapOtros.get(p) ?? 0,
      totalDebito,
      credito21: credMap21.get(p) ?? 0,
      credito105: credMap105.get(p) ?? 0,
      creditoOtros: credMapOtros.get(p) ?? 0,
      totalCredito,
      posicionNeta,
      retenciones,
      percepciones: 0,
      saldoFinal: saldoAcum,
    };
  });
}

// ---------------------------------------------------------------------------
// 3. Historial de Pagos
// ---------------------------------------------------------------------------

export interface PagoImpuestoRow {
  id: number;
  fechaPago: string;
  tipo: string;
  tipoLabel: string;
  jurisdiccion: string;
  jurisdiccionLabel: string;
  periodoFiscal: string;
  concepto: string;
  monto: number;
  medioPago: string;
  comprobante: string;
}

export async function fetchPagosImpuestos(): Promise<PagoImpuestoRow[]> {
  const rows = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_pagos_impuestos");
    if (res.error) throw res.error;
    return (res.data ?? []) as Array<{
      id: number; fecha_pago: string; monto: number; medio_pago: string;
      numero_vep: string; formulario: string; observaciones: string;
      obligacion_tipo: string; obligacion_periodo: string; obligacion_fuente: string;
    }>;
  });

  return rows.map((p) => {
    const tipo = (p.obligacion_tipo ?? "otro") as string;
    const fuente = (p.obligacion_fuente ?? jurisdiccionFromTipo(tipo)) as string;
    return {
      id: p.id,
      fechaPago: p.fecha_pago as string,
      tipo,
      tipoLabel: tipoLabel(tipo),
      jurisdiccion: fuente,
      jurisdiccionLabel: fuenteLabel(fuente),
      periodoFiscal: (p.obligacion_periodo ?? "") as string,
      concepto: (p.observaciones ?? p.formulario ?? "") as string,
      monto: Number(p.monto) || 0,
      medioPago: (p.medio_pago ?? "") as string,
      comprobante: (p.numero_vep ?? "") as string,
    };
  });
}

// ---------------------------------------------------------------------------
// 4. Calendario de Vencimientos
// ---------------------------------------------------------------------------

export interface VencimientoRow {
  id: number;
  fecha: string;
  tipo: string;
  tipoLabel: string;
  jurisdiccion: string;
  jurisdiccionLabel: string;
  periodoFiscal: string;
  montoEstimado: number | null;
  estado: string;
}

export async function fetchVencimientos(): Promise<VencimientoRow[]> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase
      .from("impuesto_obligacion")
      .select("id, tipo, periodo, fuente, fecha_vencimiento, monto_determinado, estado")
      .not("fecha_vencimiento", "is", null)
      .order("fecha_vencimiento", { ascending: true });
    if (res.error) throw res.error;
    return res.data;
  });

  return (data ?? []).map((o) => {
    const tipo = o.tipo as string;
    const fuente = (o.fuente as string) ?? jurisdiccionFromTipo(tipo);
    return {
      id: o.id as number,
      fecha: o.fecha_vencimiento as string,
      tipo,
      tipoLabel: tipoLabel(tipo),
      jurisdiccion: fuente,
      jurisdiccionLabel: fuenteLabel(fuente),
      periodoFiscal: (o.periodo as string) ?? "",
      montoEstimado: Number(o.monto_determinado) || null,
      estado: o.estado as string,
    };
  });
}

// Determine visual status for calendar entries
export function vencimientoColor(fecha: string, estado: string): { bg: string; text: string; label: string } {
  const today = new Date().toISOString().slice(0, 10);
  if (estado === "pagado") return { bg: "bg-green-50", text: "text-green-700", label: "Pagado" };
  if (fecha < today) return { bg: "bg-red-50", text: "text-red-700", label: "Vencido" };
  // Check if within 7 days
  const diff = (new Date(fecha).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
  if (diff <= 7) return { bg: "bg-amber-50", text: "text-amber-700", label: "Próximo" };
  return { bg: "bg-gray-50", text: "text-gray-600", label: "Pendiente" };
}

// Jurisdiction color for calendar dots
export function jurisdiccionColor(jurisdiccion: string): string {
  if (jurisdiccion === "arca") return "bg-blue-500";
  if (jurisdiccion === "arba") return "bg-green-500";
  return "bg-orange-500";
}

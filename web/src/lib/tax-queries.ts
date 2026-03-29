/**
 * Queries for the Impuestos module.
 * Resumen Fiscal, Posición IVA, Historial de Pagos, Calendario.
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

// Labels for tipo_impuesto_enum
const TIPO_LABELS: Record<string, string> = {
  iva: "IVA",
  ganancias: "Ganancias",
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
  if (tipo === "iva" || tipo === "ganancias" || tipo === "debitos_creditos") return "arca";
  if (tipo === "iibb") return "arba";
  return "municipio";
}

// ---------------------------------------------------------------------------
// 1. Resumen Fiscal
// ---------------------------------------------------------------------------

export interface ResumenMensualRow {
  periodo: string;
  iva: number;
  ganancias: number;
  iibb: number;
  tasaMunicipal: number;
  cargasSociales: number;
  debitosCreditos: number;
  total: number;
  ingresos: number;
  presionFiscal: number;
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
}

export async function fetchResumenFiscal(): Promise<ResumenFiscalData> {
  const [obligRes, pagosRes, factRes, ventaRes] = await Promise.all([
    supabase.from("impuesto_obligacion").select("id, tipo, periodo, fuente, fecha_vencimiento, monto_determinado, estado"),
    supabase.from("pago_impuesto").select("id, impuesto_obligacion_id, fecha_pago, monto, observaciones"),
    supabase.from("factura_emitida").select("fecha_emision, imp_neto_gravado_total"),
    supabase.from("venta").select("fecha, monto_total"),
  ]);

  if (obligRes.error) throw obligRes.error;
  if (pagosRes.error) throw pagosRes.error;
  if (factRes.error) throw factRes.error;
  if (ventaRes.error) throw ventaRes.error;

  // Build obligacion lookup
  const obligMap = new Map<number, { tipo: string; fuente: string | null; periodo: string }>();
  for (const o of obligRes.data ?? []) {
    obligMap.set(o.id as number, {
      tipo: o.tipo as string,
      fuente: (o.fuente as string) ?? null,
      periodo: o.periodo as string,
    });
  }

  // Aggregate pagos by tipo and month
  const tipoMonthMap = new Map<string, Map<string, number>>(); // tipo -> month -> sum
  const jurisdiccionTotal = new Map<string, number>();

  for (const p of pagosRes.data ?? []) {
    const obligId = p.impuesto_obligacion_id as number | null;
    let tipo = "otro";
    let fuente = "otro";
    if (obligId && obligMap.has(obligId)) {
      const ob = obligMap.get(obligId)!;
      tipo = ob.tipo;
      fuente = ob.fuente ?? jurisdiccionFromTipo(ob.tipo);
    } else {
      // Try to infer from observaciones
      const obs = ((p.observaciones as string) ?? "").toLowerCase();
      if (obs.includes("931") || obs.includes("sicoss") || obs.includes("contribucion")) {
        tipo = "cargas_sociales";
        fuente = "arca";
      } else if (obs.includes("iva")) {
        tipo = "iva"; fuente = "arca";
      } else if (obs.includes("ganancias")) {
        tipo = "ganancias"; fuente = "arca";
      } else if (obs.includes("iibb") || obs.includes("ingresos brutos")) {
        tipo = "iibb"; fuente = "arba";
      }
    }

    const month = (p.fecha_pago as string).slice(0, 7);
    const monto = Number(p.monto) || 0;

    if (!tipoMonthMap.has(tipo)) tipoMonthMap.set(tipo, new Map());
    addToMap(tipoMonthMap.get(tipo)!, month, monto);
    addToMap(jurisdiccionTotal, fuente, monto);
  }

  // Ingresos by month
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
  tipoMonthMap.forEach((m) => m.forEach((_, k) => allP.add(k)));
  ingresosMap.forEach((_, k) => allP.add(k));

  const mensual: ResumenMensualRow[] = Array.from(allP).sort().map((p) => {
    const get = (tipo: string) => tipoMonthMap.get(tipo)?.get(p) ?? 0;
    const iva = get("iva");
    const ganancias = get("ganancias");
    const iibb = get("iibb");
    const tasaMunicipal = get("tasa_seguridad_higiene") + get("tasa_publicidad_propaganda") + get("tasa_ocupacion_espacio_publico");
    const cargasSociales = get("cargas_sociales");
    const debitosCreditos = get("debitos_creditos");
    const total = iva + ganancias + iibb + tasaMunicipal + cargasSociales + debitosCreditos;
    const ingresos = ingresosMap.get(p) ?? 0;
    const presionFiscal = ingresos > 0 ? (total / ingresos) * 100 : 0;
    return { periodo: p, iva, ganancias, iibb, tasaMunicipal, cargasSociales, debitosCreditos, total, ingresos, presionFiscal };
  });

  // Jurisdicción donut
  const distribucionJurisdiccion = Array.from(jurisdiccionTotal.entries())
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: fuenteLabel(k), value: v }))
    .sort((a, b) => b.value - a.value);

  // Próximo vencimiento
  const today = new Date().toISOString().slice(0, 10);
  const pendientes = (obligRes.data ?? [])
    .filter((o) => (o.estado === "pendiente" || o.estado === "vencido") && o.fecha_vencimiento)
    .sort((a, b) => (a.fecha_vencimiento as string).localeCompare(b.fecha_vencimiento as string));

  const futuro = pendientes.find((o) => (o.fecha_vencimiento as string) >= today);
  const proximoVto: ProximoVencimiento | null = futuro
    ? { fecha: futuro.fecha_vencimiento as string, impuesto: tipoLabel(futuro.tipo as string), monto: Number(futuro.monto_determinado) || null }
    : pendientes.length > 0
      ? { fecha: pendientes[pendientes.length - 1].fecha_vencimiento as string, impuesto: tipoLabel(pendientes[pendientes.length - 1].tipo as string), monto: Number(pendientes[pendientes.length - 1].monto_determinado) || null }
      : null;

  return { mensual, distribucionJurisdiccion, proximoVto };
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
  const [emitRes, recibRes] = await Promise.all([
    supabase.from("factura_emitida").select(
      "fecha_emision, iva_21, iva_10_5, iva_27, iva_5, iva_2_5, iva_0_neto, total_iva"
    ),
    supabase.from("factura_recibida").select(
      "fecha_emision, iva_21, iva_10_5, iva_27, iva_5, iva_2_5, iva_0_neto, total_iva, otros_tributos"
    ),
  ]);

  if (emitRes.error) throw emitRes.error;
  if (recibRes.error) throw recibRes.error;

  // Débito fiscal (from factura_emitida)
  const debMap21 = new Map<string, number>();
  const debMap105 = new Map<string, number>();
  const debMapOtros = new Map<string, number>();
  const debMapTotal = new Map<string, number>();

  for (const r of emitRes.data ?? []) {
    const p = (r.fecha_emision as string).slice(0, 7);
    const d21 = Number(r.iva_21) || 0;
    const d105 = Number(r.iva_10_5) || 0;
    const d27 = Number(r.iva_27) || 0;
    const d5 = Number(r.iva_5) || 0;
    const d25 = Number(r.iva_2_5) || 0;
    const otros = d27 + d5 + d25;
    addToMap(debMap21, p, d21);
    addToMap(debMap105, p, d105);
    addToMap(debMapOtros, p, otros);
    addToMap(debMapTotal, p, Number(r.total_iva) || (d21 + d105 + otros));
  }

  // Crédito fiscal (from factura_recibida)
  const credMap21 = new Map<string, number>();
  const credMap105 = new Map<string, number>();
  const credMapOtros = new Map<string, number>();
  const credMapTotal = new Map<string, number>();
  const retMap = new Map<string, number>();

  for (const r of recibRes.data ?? []) {
    const p = (r.fecha_emision as string).slice(0, 7);
    const c21 = Number(r.iva_21) || 0;
    const c105 = Number(r.iva_10_5) || 0;
    const c27 = Number(r.iva_27) || 0;
    const c5 = Number(r.iva_5) || 0;
    const c25 = Number(r.iva_2_5) || 0;
    const otros = c27 + c5 + c25;
    addToMap(credMap21, p, c21);
    addToMap(credMap105, p, c105);
    addToMap(credMapOtros, p, otros);
    addToMap(credMapTotal, p, Number(r.total_iva) || (c21 + c105 + otros));
    addToMap(retMap, p, Number(r.otros_tributos) || 0);
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
  const [pagosRes, obligRes] = await Promise.all([
    supabase.from("pago_impuesto").select("id, impuesto_obligacion_id, fecha_pago, monto, medio_pago, numero_vep, formulario, observaciones"),
    supabase.from("impuesto_obligacion").select("id, tipo, periodo, fuente"),
  ]);

  if (pagosRes.error) throw pagosRes.error;
  if (obligRes.error) throw obligRes.error;

  const obligMap = new Map<number, { tipo: string; periodo: string; fuente: string }>();
  for (const o of obligRes.data ?? []) {
    obligMap.set(o.id as number, {
      tipo: o.tipo as string,
      periodo: (o.periodo as string) ?? "",
      fuente: (o.fuente as string) ?? "",
    });
  }

  return (pagosRes.data ?? []).map((p) => {
    const obligId = p.impuesto_obligacion_id as number | null;
    const ob = obligId ? obligMap.get(obligId) : null;
    const tipo = ob?.tipo ?? "otro";
    const fuente = ob?.fuente ?? jurisdiccionFromTipo(tipo);
    return {
      id: p.id as number,
      fechaPago: p.fecha_pago as string,
      tipo,
      tipoLabel: tipoLabel(tipo),
      jurisdiccion: fuente,
      jurisdiccionLabel: fuenteLabel(fuente),
      periodoFiscal: ob?.periodo ?? "",
      concepto: (p.observaciones as string) ?? (p.formulario as string) ?? "",
      monto: Number(p.monto) || 0,
      medioPago: (p.medio_pago as string) ?? "",
      comprobante: (p.numero_vep as string) ?? "",
    };
  }).sort((a, b) => b.fechaPago.localeCompare(a.fechaPago));
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
  const { data, error } = await supabase
    .from("impuesto_obligacion")
    .select("id, tipo, periodo, fuente, fecha_vencimiento, monto_determinado, estado")
    .not("fecha_vencimiento", "is", null)
    .order("fecha_vencimiento", { ascending: true });

  if (error) throw error;

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

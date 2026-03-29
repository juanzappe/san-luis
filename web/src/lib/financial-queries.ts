/**
 * Queries for the Financiero module.
 * Flujo de fondos, Tenencias, Inversiones, Cuentas por cobrar/pagar.
 */
import { supabase } from "./supabase";
import { formatARS, formatPct, pctDelta, periodoLabel, shortLabel } from "./economic-queries";

// Re-export helpers so pages import from a single module
export { formatARS, formatPct, pctDelta, periodoLabel, shortLabel };

// ---------------------------------------------------------------------------
// 1. Flujo de Fondos
// ---------------------------------------------------------------------------

export interface FlujoDeFondosRow {
  periodo: string;
  cobrosEfectivo: number;
  cobrosBanco: number;
  cobrosMP: number;
  totalCobros: number;
  pagosProveedores: number;
  sueldos: number;
  impuestos: number;
  comisionesBancarias: number;
  totalPagos: number;
  flujoNeto: number;
  acumulado: number;
}

const COMISION_KEYWORDS = [
  "comision", "interes", "mantenimiento", "seguro",
  "sellado", "impuesto s/deb", "impuesto s/cred",
];

function isComisionBancaria(concepto: string): boolean {
  const lower = concepto.toLowerCase();
  return COMISION_KEYWORDS.some((kw) => lower.includes(kw));
}

function addToMap(map: Map<string, number>, key: string, val: number) {
  map.set(key, (map.get(key) ?? 0) + val);
}

export async function fetchFlujoDeFondos(): Promise<FlujoDeFondosRow[]> {
  const [cajaRes, bancoRes, mpRes, sueldosRes, impRes] = await Promise.all([
    supabase.from("movimiento_caja").select("fecha, condicion_pago, tipo, importe"),
    supabase.from("movimiento_bancario").select("fecha, credito, debito, concepto"),
    supabase.from("movimiento_mp").select("fecha, importe"),
    supabase.from("liquidacion_sueldo").select("periodo, sueldo_neto"),
    supabase.from("pago_impuesto").select("fecha_pago, monto"),
  ]);

  if (cajaRes.error) throw cajaRes.error;
  if (bancoRes.error) throw bancoRes.error;
  if (mpRes.error) throw mpRes.error;
  if (sueldosRes.error) throw sueldosRes.error;
  if (impRes.error) throw impRes.error;

  // 1) Cobros efectivo: movimiento_caja EFECTIVO + Venta Contado
  const cobrosEfectivoMap = new Map<string, number>();
  for (const r of cajaRes.data ?? []) {
    if (r.condicion_pago === "EFECTIVO" && r.tipo === "Venta Contado") {
      const p = (r.fecha as string).slice(0, 7);
      addToMap(cobrosEfectivoMap, p, Number(r.importe) || 0);
    }
  }

  // 2) Banco: split credits (cobros) vs debits (pagos or comisiones)
  const cobrosBancoMap = new Map<string, number>();
  const pagosProvMap = new Map<string, number>();
  const comisionesMap = new Map<string, number>();
  for (const r of bancoRes.data ?? []) {
    const p = (r.fecha as string).slice(0, 7);
    const cred = Number(r.credito) || 0;
    const deb = Number(r.debito) || 0;
    if (cred > 0) {
      addToMap(cobrosBancoMap, p, cred);
    }
    if (deb > 0) {
      if (isComisionBancaria(r.concepto ?? "")) {
        addToMap(comisionesMap, p, deb);
      } else {
        addToMap(pagosProvMap, p, deb);
      }
    }
  }

  // 3) MP: positive importe = cobro
  const cobrosMPMap = new Map<string, number>();
  for (const r of mpRes.data ?? []) {
    const imp = Number(r.importe) || 0;
    if (imp > 0) {
      const p = (r.fecha as string).slice(0, 7);
      addToMap(cobrosMPMap, p, imp);
    }
  }

  // 4) Sueldos
  const sueldosMap = new Map<string, number>();
  for (const r of sueldosRes.data ?? []) {
    const p = (r.periodo as string).slice(0, 7);
    addToMap(sueldosMap, p, Number(r.sueldo_neto) || 0);
  }

  // 5) Impuestos
  const impuestosMap = new Map<string, number>();
  for (const r of impRes.data ?? []) {
    const p = (r.fecha_pago as string).slice(0, 7);
    addToMap(impuestosMap, p, Number(r.monto) || 0);
  }

  // Merge all periodos
  const allP = new Set<string>();
  for (const m of [cobrosEfectivoMap, cobrosBancoMap, cobrosMPMap, pagosProvMap, sueldosMap, impuestosMap, comisionesMap]) {
    m.forEach((_, k) => allP.add(k));
  }

  const sorted = Array.from(allP).sort();
  let acum = 0;

  return sorted.map((p) => {
    const cobrosEfectivo = cobrosEfectivoMap.get(p) ?? 0;
    const cobrosBanco = cobrosBancoMap.get(p) ?? 0;
    const cobrosMP = cobrosMPMap.get(p) ?? 0;
    const totalCobros = cobrosEfectivo + cobrosBanco + cobrosMP;

    const pagosProveedores = pagosProvMap.get(p) ?? 0;
    const sueldos = sueldosMap.get(p) ?? 0;
    const impuestos = impuestosMap.get(p) ?? 0;
    const comisionesBancarias = comisionesMap.get(p) ?? 0;
    const totalPagos = pagosProveedores + sueldos + impuestos + comisionesBancarias;

    const flujoNeto = totalCobros - totalPagos;
    acum += flujoNeto;

    return {
      periodo: p,
      cobrosEfectivo, cobrosBanco, cobrosMP, totalCobros,
      pagosProveedores, sueldos, impuestos, comisionesBancarias, totalPagos,
      flujoNeto,
      acumulado: acum,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Tenencias
// ---------------------------------------------------------------------------

export interface TenenciaRow {
  tipo: string;
  denominacion: string;
  moneda: string;
  saldo: number;
  saldoArs: number;
}

export interface TenenciaHistory {
  periodo: string;
  total: number;
  byTipo: Record<string, number>;
}

export interface TenenciasData {
  current: TenenciaRow[];
  history: TenenciaHistory[];
  hasData: boolean;
}

const TIPO_LABELS: Record<string, string> = {
  cuenta_bancaria: "Banco",
  caja_pesos: "Caja $",
  caja_dolares: "Caja USD",
  plazo_fijo: "Plazo Fijo",
  fci: "FCI",
  cheque: "Cheques",
  billetera_digital: "MP/Billetera",
  broker: "Inversiones",
};

export function tenenciaTipoLabel(tipo: string): string {
  return TIPO_LABELS[tipo] ?? tipo;
}

export async function fetchTenencias(): Promise<TenenciasData> {
  const { data, error } = await supabase
    .from("tenencia")
    .select("fecha, tipo, denominacion, moneda, saldo, saldo_ars")
    .order("fecha", { ascending: true });

  if (error) throw error;
  if (!data || data.length === 0) return { current: [], history: [], hasData: false };

  // Latest date for "current" snapshot
  const latestFecha = data[data.length - 1].fecha as string;
  const current: TenenciaRow[] = data
    .filter((r) => r.fecha === latestFecha)
    .map((r) => ({
      tipo: r.tipo as string,
      denominacion: r.denominacion as string ?? "",
      moneda: r.moneda as string ?? "ARS",
      saldo: Number(r.saldo) || 0,
      saldoArs: Number(r.saldo_ars ?? r.saldo) || 0,
    }));

  // History: group by month, sum saldo_ars by tipo
  const histMap = new Map<string, { total: number; byTipo: Record<string, number> }>();
  for (const r of data) {
    const p = (r.fecha as string).slice(0, 7);
    const entry = histMap.get(p) ?? { total: 0, byTipo: {} };
    const ars = Number(r.saldo_ars ?? r.saldo) || 0;
    const tipo = r.tipo as string;
    entry.total += ars;
    entry.byTipo[tipo] = (entry.byTipo[tipo] ?? 0) + ars;
    histMap.set(p, entry);
  }

  const history: TenenciaHistory[] = Array.from(histMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periodo, v]) => ({ periodo, ...v }));

  return { current, history, hasData: true };
}

// ---------------------------------------------------------------------------
// 3. Inversiones
// ---------------------------------------------------------------------------

export interface InversionRow {
  id: number;
  ticker: string;
  nombre: string;
  tipo: string;
  moneda: string;
  cantidad: number;
  valuacionPrecio: number;
  valuacionMonto: number;
  valuacionUsd: number;
  costoTotal: number;
  resultado: number;
  variacionPct: number;
}

export interface InversionMovRow {
  id: number;
  fecha: string;
  ticker: string;
  descripcion: string;
  tipoOp: string;
  cantidad: number;
  precio: number;
  importeNeto: number;
  moneda: string;
}

export interface InversionesData {
  holdings: InversionRow[];
  movimientos: InversionMovRow[];
  hasData: boolean;
}

export async function fetchInversiones(): Promise<InversionesData> {
  const [holdRes, movRes] = await Promise.all([
    supabase
      .from("inversion")
      .select("id, ticker, nombre, tipo, moneda, cantidad, valuacion_precio, valuacion_monto, valuacion_usd, costo_total, resultado, variacion_pct")
      .eq("estado", "vigente"),
    supabase
      .from("inversion_movimiento")
      .select("id, fecha_liquidacion, ticker, descripcion, tipo_operacion, cantidad_vn, precio, importe_neto, moneda")
      .order("fecha_liquidacion", { ascending: false }),
  ]);

  if (holdRes.error) throw holdRes.error;
  if (movRes.error) throw movRes.error;

  const holdings: InversionRow[] = (holdRes.data ?? []).map((r) => ({
    id: r.id as number,
    ticker: (r.ticker ?? "") as string,
    nombre: (r.nombre ?? "") as string,
    tipo: (r.tipo ?? "") as string,
    moneda: (r.moneda ?? "ARS") as string,
    cantidad: Number(r.cantidad) || 0,
    valuacionPrecio: Number(r.valuacion_precio) || 0,
    valuacionMonto: Number(r.valuacion_monto) || 0,
    valuacionUsd: Number(r.valuacion_usd) || 0,
    costoTotal: Number(r.costo_total) || 0,
    resultado: Number(r.resultado) || 0,
    variacionPct: Number(r.variacion_pct) || 0,
  }));

  const movimientos: InversionMovRow[] = (movRes.data ?? []).map((r) => ({
    id: r.id as number,
    fecha: (r.fecha_liquidacion ?? "") as string,
    ticker: (r.ticker ?? "") as string,
    descripcion: (r.descripcion ?? "") as string,
    tipoOp: (r.tipo_operacion ?? "") as string,
    cantidad: Number(r.cantidad_vn) || 0,
    precio: Number(r.precio) || 0,
    importeNeto: Number(r.importe_neto) || 0,
    moneda: (r.moneda ?? "ARS") as string,
  }));

  return { holdings, movimientos, hasData: holdings.length > 0 || movimientos.length > 0 };
}

// ---------------------------------------------------------------------------
// 4. Cuentas por Cobrar
// ---------------------------------------------------------------------------

export interface CuentaCobrarRow {
  id: number;
  cliente: string;
  cuit: string;
  factura: string;
  fechaEmision: string;
  vencimiento: string | null;
  monto: number;
  diasPendientes: number;
  estado: string;
}

export interface AgingBucket {
  label: string;
  monto: number;
  count: number;
}

function daysDiff(from: string, to: Date): number {
  const d = new Date(from);
  return Math.floor((to.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function formatFactura(tipo: number, pv: number, num: number): string {
  const tipoStr = tipo === 1 ? "A" : tipo === 6 ? "B" : tipo === 11 ? "C" : String(tipo);
  return `FC ${tipoStr} ${String(pv).padStart(4, "0")}-${String(num).padStart(8, "0")}`;
}

function buildAgingBuckets(rows: { monto: number; diasPendientes: number }[]): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { label: "0–30 días", monto: 0, count: 0 },
    { label: "31–60 días", monto: 0, count: 0 },
    { label: "61–90 días", monto: 0, count: 0 },
    { label: "90+ días", monto: 0, count: 0 },
  ];
  for (const r of rows) {
    const d = r.diasPendientes;
    const idx = d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3;
    buckets[idx].monto += r.monto;
    buckets[idx].count += 1;
  }
  return buckets;
}

export { buildAgingBuckets };

export async function fetchCuentasCobrar(): Promise<CuentaCobrarRow[]> {
  const { data, error } = await supabase
    .from("factura_emitida")
    .select("id, fecha_emision, fecha_vencimiento_pago, imp_total, denominacion_receptor, nro_doc_receptor, tipo_comprobante, punto_venta, numero_desde, estado")
    .in("estado", ["pendiente", "parcial"]);

  if (error) throw error;
  if (!data) return [];

  const today = new Date();

  return data.map((r) => ({
    id: r.id as number,
    cliente: (r.denominacion_receptor ?? "—") as string,
    cuit: (r.nro_doc_receptor ?? "") as string,
    factura: formatFactura(
      Number(r.tipo_comprobante) || 0,
      Number(r.punto_venta) || 0,
      Number(r.numero_desde) || 0,
    ),
    fechaEmision: r.fecha_emision as string,
    vencimiento: (r.fecha_vencimiento_pago as string) ?? null,
    monto: Number(r.imp_total) || 0,
    diasPendientes: daysDiff(r.fecha_emision as string, today),
    estado: r.estado as string,
  }));
}

// ---------------------------------------------------------------------------
// 5. Cuentas por Pagar
// ---------------------------------------------------------------------------

export interface CuentaPagarRow {
  id: number;
  proveedor: string;
  cuit: string;
  factura: string;
  fechaEmision: string;
  vencimiento: string | null;
  monto: number;
  diasPendientes: number;
  estado: string;
}

export async function fetchCuentasPagar(): Promise<CuentaPagarRow[]> {
  const { data, error } = await supabase
    .from("factura_recibida")
    .select("id, fecha_emision, fecha_vencimiento_pago, imp_total, denominacion_emisor, nro_doc_emisor, tipo_comprobante, punto_venta, numero_desde, estado")
    .in("estado", ["pendiente", "parcial"]);

  if (error) throw error;
  if (!data) return [];

  const today = new Date();

  return data.map((r) => ({
    id: r.id as number,
    proveedor: (r.denominacion_emisor ?? "—") as string,
    cuit: (r.nro_doc_emisor ?? "") as string,
    factura: formatFactura(
      Number(r.tipo_comprobante) || 0,
      Number(r.punto_venta) || 0,
      Number(r.numero_desde) || 0,
    ),
    fechaEmision: r.fecha_emision as string,
    vencimiento: (r.fecha_vencimiento_pago as string) ?? null,
    monto: Number(r.imp_total) || 0,
    diasPendientes: daysDiff(r.fecha_emision as string, today),
    estado: r.estado as string,
  }));
}

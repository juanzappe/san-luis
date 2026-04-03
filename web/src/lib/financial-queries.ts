/**
 * Queries for the Financiero module.
 * Flujo de fondos, Tenencias, Inversiones, Cuentas por cobrar/pagar.
 */
import { supabase } from "./supabase";
import { fetchWithRetry } from "./fetchWithRetry";
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

// RPC row type for get_flujo_fondos
type RpcFlujoRow = {
  periodo: string;
  cobros_efectivo: number;
  cobros_banco: number;
  cobros_mp: number;
  pagos_proveedores: number;
  sueldos: number;
  impuestos: number;
  comisiones_bancarias: number;
};

export async function fetchFlujoDeFondos(): Promise<FlujoDeFondosRow[]> {
  const rows = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_flujo_fondos");
    if (res.error) throw res.error;
    return (res.data ?? []) as RpcFlujoRow[];
  });

  let acum = 0;

  return rows.map((r) => {
    const cobrosEfectivo = Number(r.cobros_efectivo) || 0;
    const cobrosBanco = Number(r.cobros_banco) || 0;
    const cobrosMP = Number(r.cobros_mp) || 0;
    const totalCobros = cobrosEfectivo + cobrosBanco + cobrosMP;

    const pagosProveedores = Number(r.pagos_proveedores) || 0;
    const sueldos = Number(r.sueldos) || 0;
    const impuestos = Number(r.impuestos) || 0;
    const comisionesBancarias = Number(r.comisiones_bancarias) || 0;
    const totalPagos = pagosProveedores + sueldos + impuestos + comisionesBancarias;

    const flujoNeto = totalCobros - totalPagos;
    acum += flujoNeto;

    return {
      periodo: r.periodo,
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
  const data = await fetchWithRetry(async () => {
    const res = await supabase
      .from("tenencia")
      .select("fecha, tipo, denominacion, moneda, saldo, saldo_ars")
      .order("fecha", { ascending: true });
    if (res.error) throw res.error;
    return res.data;
  });

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
  const [holdData, movData] = await Promise.all([
    fetchWithRetry(async () => {
      const res = await supabase
        .from("inversion")
        .select("id, ticker, nombre, tipo, moneda, cantidad, valuacion_precio, valuacion_monto, valuacion_usd, costo_total, resultado, variacion_pct")
        .eq("estado", "vigente");
      if (res.error) throw res.error;
      return res.data;
    }),
    fetchWithRetry(async () => {
      const res = await supabase
        .from("inversion_movimiento")
        .select("id, fecha_liquidacion, ticker, descripcion, tipo_operacion, cantidad_vn, precio, importe_neto, moneda")
        .order("fecha_liquidacion", { ascending: false });
      if (res.error) throw res.error;
      return res.data;
    }),
  ]);

  // Sanitize string values that may have been stored as "nan" by old ETL runs
  const dbStr = (v: unknown): string => {
    const s = String(v ?? "").trim();
    return s === "nan" || s === "null" ? "" : s;
  };

  const holdings: InversionRow[] = (holdData ?? []).map((r) => ({
    id: r.id as number,
    ticker: dbStr(r.ticker),
    nombre: dbStr(r.nombre),
    tipo: dbStr(r.tipo),
    moneda: dbStr(r.moneda) || "ARS",
    cantidad: Number(r.cantidad) || 0,
    valuacionPrecio: Number(r.valuacion_precio) || 0,
    valuacionMonto: Number(r.valuacion_monto) || 0,
    valuacionUsd: Number(r.valuacion_usd) || 0,
    costoTotal: Number(r.costo_total) || 0,
    resultado: Number(r.resultado) || 0,
    variacionPct: Number(r.variacion_pct) || 0,
  }));

  const movimientos: InversionMovRow[] = (movData ?? []).map((r) => ({
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
  const data = await fetchWithRetry(async () => {
    const res = await supabase
      .from("factura_emitida")
      .select("id, fecha_emision, fecha_vencimiento_pago, imp_total, denominacion_receptor, nro_doc_receptor, tipo_comprobante, punto_venta, numero_desde, estado")
      .in("estado", ["pendiente", "parcial"]);
    if (res.error) throw res.error;
    return res.data;
  });

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
  const data = await fetchWithRetry(async () => {
    const res = await supabase
      .from("factura_recibida")
      .select("id, fecha_emision, fecha_vencimiento_pago, imp_total, denominacion_emisor, nro_doc_emisor, tipo_comprobante, punto_venta, numero_desde, estado")
      .in("estado", ["pendiente", "parcial"]);
    if (res.error) throw res.error;
    return res.data;
  });

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

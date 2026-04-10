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
  pagosSueldos: number;
  pagosImpuestos: number;
  pagosGastosFinancieros: number;
  totalPagos: number;
  flujoNeto: number;
  acumulado: number;
  retirosSocios: number;
  resultadoInversiones: number;
}

// RPC row type for get_flujo_fondos
type RpcFlujoRow = {
  periodo: string;
  cobros_efectivo: number;
  cobros_banco: number;
  cobros_mp: number;
  pagos_proveedores: number;
  pagos_sueldos: number;
  pagos_impuestos: number;
  pagos_gastos_financieros: number;
  retiros_socios: number;
  resultado_inversiones: number;
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
    const pagosSueldos = Number(r.pagos_sueldos) || 0;
    const pagosImpuestos = Number(r.pagos_impuestos) || 0;
    const pagosGastosFinancieros = Number(r.pagos_gastos_financieros) || 0;
    const totalPagos = pagosProveedores + pagosSueldos + pagosImpuestos + pagosGastosFinancieros;
    const retirosSocios = Number(r.retiros_socios) || 0;
    const resultadoInversiones = Number(r.resultado_inversiones) || 0;

    const flujoNeto = totalCobros - totalPagos;
    acum += flujoNeto;

    return {
      periodo: r.periodo,
      cobrosEfectivo, cobrosBanco, cobrosMP, totalCobros,
      pagosProveedores, pagosSueldos, pagosImpuestos, pagosGastosFinancieros, totalPagos,
      flujoNeto,
      acumulado: acum,
      retirosSocios,
      resultadoInversiones,
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
  precioCompra: number;
  valuacionPrecio: number;
  valuacionMonto: number;
  valuacionUsd: number;
  costoTotal: number;
  resultado: number;
  variacionPct: number;
  fechaValuacion: string | null;
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
  latestFechaValuacion: string | null;
}

export async function fetchInversiones(): Promise<InversionesData> {
  const [holdData, movData] = await Promise.all([
    fetchWithRetry(async () => {
      const res = await supabase
        .from("inversion")
        .select("id, ticker, nombre, tipo, moneda, cantidad, precio_compra, valuacion_precio, valuacion_monto, valuacion_usd, costo_total, resultado, variacion_pct, fecha_valuacion")
        .eq("estado", "vigente")
        .order("fecha_valuacion", { ascending: false });
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

  // Derive the latest fecha_valuacion from the ordered results
  const latestFechaValuacion = (holdData?.[0]?.fecha_valuacion as string) ?? null;

  const holdings: InversionRow[] = (holdData ?? []).map((r) => ({
    id: r.id as number,
    ticker: dbStr(r.ticker),
    nombre: dbStr(r.nombre),
    tipo: dbStr(r.tipo),
    moneda: dbStr(r.moneda) || "ARS",
    cantidad: Number(r.cantidad) || 0,
    precioCompra: Number(r.precio_compra) || 0,
    valuacionPrecio: Number(r.valuacion_precio) || 0,
    valuacionMonto: Number(r.valuacion_monto) || 0,
    valuacionUsd: Number(r.valuacion_usd) || 0,
    costoTotal: Number(r.costo_total) || 0,
    resultado: Number(r.resultado) || 0,
    variacionPct: Number(r.variacion_pct) || 0,
    fechaValuacion: (r.fecha_valuacion as string) ?? null,
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

  return { holdings, movimientos, hasData: holdings.length > 0 || movimientos.length > 0, latestFechaValuacion };
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
  /** Effective paid status: manual override if set, else auto-rule (> 30 days → paid) */
  pagada: boolean;
  /** null = no manual record; boolean = explicit user override */
  pagadaManual: boolean | null;
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
  const [invoiceData, estadoData] = await Promise.all([
    fetchWithRetry(async () => {
      const res = await supabase
        .from("factura_emitida")
        .select("id, fecha_emision, fecha_vencimiento_pago, imp_total, denominacion_receptor, nro_doc_receptor, tipo_comprobante, punto_venta, numero_desde, estado")
        .in("estado", ["pendiente", "parcial"])
        .eq("punto_venta", 6);
      if (res.error) throw res.error;
      return res.data;
    }),
    fetchWithRetry(async () => {
      const res = await supabase
        .from("factura_cobro_estado")
        .select("factura_id, pagada")
        .eq("tipo", "cobrar");
      if (res.error) throw res.error;
      return res.data;
    }),
  ]);

  if (!invoiceData) return [];

  // Build override map: factura_id → pagada
  const estadoMap = new Map<number, boolean>();
  for (const e of estadoData ?? []) {
    estadoMap.set(e.factura_id as number, e.pagada as boolean);
  }

  const today = new Date();

  return invoiceData.map((r) => {
    const dias = daysDiff(r.fecha_emision as string, today);
    const pagadaManual = estadoMap.has(r.id as number) ? estadoMap.get(r.id as number)! : null;
    // Auto-rule: no manual override + older than 30 days → consider collected
    const pagada = pagadaManual !== null ? pagadaManual : dias > 30;

    return {
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
      diasPendientes: dias,
      estado: r.estado as string,
      pagada,
      pagadaManual,
    };
  });
}

export async function toggleFacturaPagada(
  facturaId: number,
  pagada: boolean,
  tipo: "cobrar" | "pagar" = "cobrar",
): Promise<void> {
  const res = await supabase
    .from("factura_cobro_estado")
    .upsert(
      {
        factura_id:    facturaId,
        tipo,
        pagada,
        fecha_marcado: new Date().toISOString().slice(0, 10),
        updated_at:    new Date().toISOString(),
      },
      { onConflict: "factura_id,tipo" },
    );
  if (res.error) throw res.error;
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
  /** Effective paid status: manual override if set, else auto-rule (> 30 days → paid) */
  pagada: boolean;
  /** null = no manual record; boolean = explicit user override */
  pagadaManual: boolean | null;
}

export async function fetchCuentasPagar(): Promise<CuentaPagarRow[]> {
  const [invoiceData, estadoData] = await Promise.all([
    fetchWithRetry(async () => {
      const res = await supabase
        .from("factura_recibida")
        .select("id, fecha_emision, fecha_vencimiento_pago, imp_total, denominacion_emisor, nro_doc_emisor, tipo_comprobante, punto_venta, numero_desde, estado")
        .in("estado", ["pendiente", "parcial"]);
      if (res.error) throw res.error;
      return res.data;
    }),
    fetchWithRetry(async () => {
      const res = await supabase
        .from("factura_cobro_estado")
        .select("factura_id, pagada")
        .eq("tipo", "pagar");
      if (res.error) throw res.error;
      return res.data;
    }),
  ]);

  if (!invoiceData) return [];

  const estadoMap = new Map<number, boolean>();
  for (const e of estadoData ?? []) {
    estadoMap.set(e.factura_id as number, e.pagada as boolean);
  }

  const today = new Date();

  return invoiceData.map((r) => {
    const dias = daysDiff(r.fecha_emision as string, today);
    const pagadaManual = estadoMap.has(r.id as number) ? estadoMap.get(r.id as number)! : null;
    const pagada = pagadaManual !== null ? pagadaManual : dias > 30;

    return {
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
      diasPendientes: dias,
      estado: r.estado as string,
      pagada,
      pagadaManual,
    };
  });
}

// ---------------------------------------------------------------------------
// 6. Saldos de cuentas financieras (RPC get_saldos_cuentas)
// ---------------------------------------------------------------------------

export interface SaldoCuenta {
  cuenta: string;    // 'inviu' | 'santander' | 'provincia' | 'mercado_pago' | 'caja'
  nombre: string;
  saldoArs: number;
  saldoUsd: number | null;
  fechaDato: string | null;
  hasData: boolean;
}

const CUENTA_NOMBRES: Record<string, string> = {
  inviu:        "Inviu (Broker)",
  santander:    "Banco Santander",
  provincia:    "Banco Provincia",
  mercado_pago: "Mercado Pago",
  caja:         "Caja (Efectivo)",
};

export async function fetchSaldosCuentas(): Promise<SaldoCuenta[]> {
  const rows = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_saldos_cuentas");
    if (res.error) throw res.error;
    return (res.data ?? []) as {
      cuenta: string;
      saldo_ars: number | null;
      saldo_usd: number | null;
      fecha_dato: string | null;
    }[];
  });

  return rows.map((r) => ({
    cuenta:    r.cuenta,
    nombre:    CUENTA_NOMBRES[r.cuenta] ?? r.cuenta,
    saldoArs:  Number(r.saldo_ars) || 0,
    saldoUsd:  r.saldo_usd != null ? Number(r.saldo_usd) : null,
    fechaDato: r.fecha_dato ?? null,
    hasData:   r.fecha_dato != null,
  }));
}

// ---------------------------------------------------------------------------
// 8. Saldo manual (caja y otras cuentas sin fuente automática)
// ---------------------------------------------------------------------------

export interface SaldoManual {
  id: number;
  cuenta: string;
  saldo: number;
  fecha: string;
  nota: string | null;
}

export async function fetchSaldoManual(cuenta: string): Promise<SaldoManual | null> {
  const res = await supabase
    .from("saldo_manual")
    .select("id, cuenta, saldo, fecha, nota")
    .eq("cuenta", cuenta)
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) return null;
  return {
    id:     res.data.id as number,
    cuenta: res.data.cuenta as string,
    saldo:  Number(res.data.saldo),
    fecha:  res.data.fecha as string,
    nota:   (res.data.nota as string | null) ?? null,
  };
}

export async function insertSaldoManual(
  cuenta: string,
  saldo: number,
  fecha: string,
  nota: string,
): Promise<void> {
  const res = await supabase
    .from("saldo_manual")
    .insert({ cuenta, saldo, fecha, nota: nota.trim() || null });
  if (res.error) throw res.error;
}

/**
 * Queries for the Unidades de Negocio module.
 * Resumen, Mostrador, Restobar, Servicios, Decoración.
 */
import { supabase } from "./supabase";
import { ECONOMICO_MIN_PERIODO, formatARS, formatPct, pctDelta, periodoLabel, shortLabel } from "./economic-queries";

export { formatARS, formatPct, pctDelta, periodoLabel, shortLabel };

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface UnitMonthly {
  periodo: string;
  mostrador: number;
  restobar: number;
  servicios: number;
  total: number;
}

export interface HeatmapCell {
  day: number;   // 0=Domingo … 6=Sábado
  hour: number;  // 0–23
  monto: number;
  count: number;
}

// ---------------------------------------------------------------------------
// 1. Resumen — Cross-unit monthly comparison
// ---------------------------------------------------------------------------

export interface ResumenData {
  monthly: UnitMonthly[];
  kpis: {
    totalMostrador: number;
    totalRestobar: number;
    totalServicios: number;
    total: number;
    ticketMostrador: number;
    ticketRestobar: number;
    ticketServicios: number;
  };
}

export async function fetchResumen(): Promise<ResumenData> {
  // Use server-side RPC for correct aggregation (avoids 1000-row limit + NC sign)
  const { data: ingData, error: ingErr } = await supabase.rpc("get_ingresos_mensual");
  if (ingErr) throw ingErr;

  type IngRow = { periodo: string; mostrador: number; restobar: number; servicios: number };
  const rows = (ingData ?? []) as IngRow[];

  const monthly = rows
    .map((r) => {
      const mostrador = Number(r.mostrador) || 0;
      const restobar = Number(r.restobar) || 0;
      const servicios = Number(r.servicios) || 0;
      return { periodo: r.periodo, mostrador, restobar, servicios, total: mostrador + restobar + servicios };
    })
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .filter((r) => r.periodo >= ECONOMICO_MIN_PERIODO);

  const totalMostrador = monthly.reduce((s, r) => s + r.mostrador, 0);
  const totalRestobar = monthly.reduce((s, r) => s + r.restobar, 0);
  const totalServicios = monthly.reduce((s, r) => s + r.servicios, 0);

  // Tx counts: we need venta count for ticket promedio — use a simple count query
  const [mosCntRes, resCntRes, servCntRes] = await Promise.all([
    supabase.from("venta").select("id", { count: "exact", head: true }),
    supabase.from("venta_detalle").select("id", { count: "exact", head: true }).ilike("producto", "restobar"),
    supabase.from("factura_emitida").select("id", { count: "exact", head: true }).eq("punto_venta", 6),
  ]);
  const mostradorTxCount = (mosCntRes.count ?? 0) - (resCntRes.count ?? 0);
  const restobarTxCount = resCntRes.count ?? 0;
  const serviciosTxCount = servCntRes.count ?? 0;

  return {
    monthly,
    kpis: {
      totalMostrador,
      totalRestobar,
      totalServicios,
      total: totalMostrador + totalRestobar + totalServicios,
      ticketMostrador: mostradorTxCount > 0 ? totalMostrador / mostradorTxCount : 0,
      ticketRestobar: restobarTxCount > 0 ? totalRestobar / restobarTxCount : 0,
      ticketServicios: serviciosTxCount > 0 ? totalServicios / serviciosTxCount : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Mostrador — RPC-based queries (replaces client-side 170k row fetch)
// ---------------------------------------------------------------------------

export interface MostradorMonthly {
  periodo: string;
  monto: number;
  cantidad: number;
  txCount: number;
  diasConVenta: number;
}

export interface ProductoSemanalRow {
  semana: string;
  semanaInicio: string;
  cantidad: number;
  monto: number;
}

export interface MostradorRankingRow {
  producto: string;
  totalCantidad: number;
  totalMonto: number;
  diasConVenta: number;
  promedioDiario: number;
}

export async function fetchMostradorMensual(): Promise<MostradorMonthly[]> {
  const { data, error } = await supabase.rpc("get_mostrador_mensual");
  if (error) throw error;
  return ((data ?? []) as { periodo: string; monto: number; cantidad: number; tx_count: number; dias_con_venta: number }[])
    .map((r) => ({
      periodo: r.periodo,
      monto: Number(r.monto) || 0,
      cantidad: Number(r.cantidad) || 0,
      txCount: Number(r.tx_count) || 0,
      diasConVenta: Number(r.dias_con_venta) || 0,
    }))
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .filter((r) => r.periodo >= ECONOMICO_MIN_PERIODO);
}

export async function fetchMostradorHeatmap(): Promise<HeatmapCell[]> {
  const { data, error } = await supabase.rpc("get_mostrador_heatmap");
  if (error) throw error;
  return ((data ?? []) as { day: number; hour: number; monto: number; count: number }[])
    .map((r) => ({
      day: Number(r.day),
      hour: Number(r.hour),
      monto: Number(r.monto) || 0,
      count: Number(r.count) || 0,
    }));
}

export async function fetchProductosLista(): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_mostrador_productos_lista");
  if (error) throw error;
  return ((data ?? []) as { producto: string }[]).map((r) => r.producto);
}

export async function fetchProductoSemanal(producto: string): Promise<ProductoSemanalRow[]> {
  const { data, error } = await supabase.rpc("get_mostrador_producto_semanal", { p_producto: producto });
  if (error) throw error;
  return ((data ?? []) as { semana: string; semana_inicio: string; cantidad: number; monto: number }[])
    .map((r) => ({
      semana: r.semana,
      semanaInicio: r.semana_inicio,
      cantidad: Number(r.cantidad) || 0,
      monto: Number(r.monto) || 0,
    }));
}

export async function fetchRankingMensual(periodo: string): Promise<MostradorRankingRow[]> {
  const { data, error } = await supabase.rpc("get_mostrador_ranking_mensual", { p_periodo: periodo });
  if (error) throw error;
  return ((data ?? []) as { producto: string; total_cantidad: number; total_monto: number; dias_con_venta: number; promedio_diario: number }[])
    .map((r) => ({
      producto: r.producto,
      totalCantidad: Number(r.total_cantidad) || 0,
      totalMonto: Number(r.total_monto) || 0,
      diasConVenta: Number(r.dias_con_venta) || 0,
      promedioDiario: Number(r.promedio_diario) || 0,
    }));
}

// Nuevas RPCs de análisis (migración 072)
export interface ProductoMensualRow {
  periodo: string;
  producto: string;
  monto: number;
  cantidad: number;
}

export interface ProductoTendenciaRow {
  producto: string;
  cantReciente: number;
  cantPrevia: number;
  deltaPct: number | null;
  montoReciente: number;
}

export interface DiarioMtdRow {
  serie: "actual" | "mes_anterior" | "año_anterior";
  diaMes: number;
  monto: number;
  acumulado: number;
}

export async function fetchProductoMensual(top = 8, meses = 24): Promise<ProductoMensualRow[]> {
  const { data, error } = await supabase.rpc("get_mostrador_producto_mensual", { p_top: top, p_meses: meses });
  if (error) throw error;
  type Raw = { periodo: string; producto: string; monto: number; cantidad: number };
  return ((data ?? []) as Raw[]).map((r) => ({
    periodo: String(r.periodo),
    producto: String(r.producto),
    monto: Number(r.monto) || 0,
    cantidad: Number(r.cantidad) || 0,
  }));
}

export async function fetchProductoTendencia(limit = 20): Promise<ProductoTendenciaRow[]> {
  const { data, error } = await supabase.rpc("get_mostrador_producto_tendencia", { p_limit: limit });
  if (error) throw error;
  type Raw = { producto: string; cant_reciente: number; cant_previa: number; delta_pct: number | null; monto_reciente: number };
  return ((data ?? []) as Raw[]).map((r) => ({
    producto: String(r.producto),
    cantReciente: Number(r.cant_reciente) || 0,
    cantPrevia: Number(r.cant_previa) || 0,
    deltaPct: r.delta_pct === null ? null : Number(r.delta_pct),
    montoReciente: Number(r.monto_reciente) || 0,
  }));
}

export interface TicketDowRow {
  dow: number;
  ticketPromedio: number;
  diasConVenta: number;
  ventasTotales: number;
}

export async function fetchTicketPorDow(): Promise<TicketDowRow[]> {
  const { data, error } = await supabase.rpc("get_mostrador_ticket_por_dow");
  if (error) throw error;
  type Raw = { dow: number; ticket_promedio: number; dias_con_venta: number; ventas_totales: number };
  return ((data ?? []) as Raw[]).map((r) => ({
    dow: Number(r.dow) || 0,
    ticketPromedio: Number(r.ticket_promedio) || 0,
    diasConVenta: Number(r.dias_con_venta) || 0,
    ventasTotales: Number(r.ventas_totales) || 0,
  }));
}

export async function fetchDiarioMtd(): Promise<DiarioMtdRow[]> {
  const { data, error } = await supabase.rpc("get_mostrador_diario_mtd");
  if (error) throw error;
  type Raw = { serie: string; dia_mes: number; monto: number; acumulado: number };
  return ((data ?? []) as Raw[]).map((r) => ({
    serie: r.serie as DiarioMtdRow["serie"],
    diaMes: Number(r.dia_mes) || 0,
    monto: Number(r.monto) || 0,
    acumulado: Number(r.acumulado) || 0,
  }));
}

// ---------------------------------------------------------------------------
// 3. Restobar — Similar to mostrador but filtered to restobar items
// ---------------------------------------------------------------------------

export interface RestobarData {
  monthly: { periodo: string; monto: number; cantidad: number; txCount: number; diasConVenta: number }[];
  heatmap: HeatmapCell[];
  kpis: {
    totalVentas: number;
    ticketPromedio: number;
    mesTop: string;
    txTotal: number;
  };
}

export async function fetchRestobar(): Promise<RestobarData> {
  const [mensualRes, heatmapRes] = await Promise.all([
    supabase.rpc("get_restobar_mensual"),
    supabase.rpc("get_restobar_heatmap"),
  ]);
  if (mensualRes.error) throw mensualRes.error;
  if (heatmapRes.error) throw heatmapRes.error;

  const monthly = ((mensualRes.data ?? []) as { periodo: string; monto: number; cantidad: number; tx_count: number; dias_con_venta: number }[])
    .map((r) => ({
      periodo: r.periodo,
      monto: Number(r.monto) || 0,
      cantidad: Number(r.cantidad) || 0,
      txCount: Number(r.tx_count) || 0,
      diasConVenta: Number(r.dias_con_venta) || 0,
    }))
    .sort((a, b) => a.periodo.localeCompare(b.periodo))
    .filter((r) => r.periodo >= ECONOMICO_MIN_PERIODO);

  const heatmap = ((heatmapRes.data ?? []) as { day: number; hour: number; monto: number; count: number }[])
    .map((r) => ({
      day: Number(r.day),
      hour: Number(r.hour),
      monto: Number(r.monto) || 0,
      count: Number(r.count) || 0,
    }));

  let totalMonto = 0;
  let txTotal = 0;
  let mesTop = "—";
  let mesTopMonto = 0;
  for (const m of monthly) {
    totalMonto += m.monto;
    txTotal += m.txCount;
    if (m.monto > mesTopMonto) {
      mesTopMonto = m.monto;
      mesTop = periodoLabel(m.periodo);
    }
  }

  return {
    monthly,
    heatmap,
    kpis: {
      totalVentas: totalMonto,
      ticketPromedio: txTotal > 0 ? totalMonto / txTotal : 0,
      mesTop,
      txTotal,
    },
  };
}

export async function fetchRestobarTicketPorDow(): Promise<TicketDowRow[]> {
  const { data, error } = await supabase.rpc("get_restobar_ticket_por_dow");
  if (error) throw error;
  type Raw = { dow: number; ticket_promedio: number; dias_con_venta: number; ventas_totales: number };
  return ((data ?? []) as Raw[]).map((r) => ({
    dow: Number(r.dow) || 0,
    ticketPromedio: Number(r.ticket_promedio) || 0,
    diasConVenta: Number(r.dias_con_venta) || 0,
    ventasTotales: Number(r.ventas_totales) || 0,
  }));
}

// ---------------------------------------------------------------------------
// 4. Servicios — Client analysis from factura_emitida
// ---------------------------------------------------------------------------

export interface ServiciosClientRow {
  cuit: string;
  nombre: string;
  tipoEntidad: string;
  clasificacion: string;
  monto: number;
  cantFacturas: number;
  pct: number;
}

export interface ServiciosMonthly {
  periodo: string;
  publico: number;
  privado: number;
  total: number;
  txCount: number;
}

export interface ClientMonthlyRow {
  periodo: string;
  monto: number;
  txCount: number;
}

export interface ServiciosData {
  monthly: ServiciosMonthly[];
  clients: ServiciosClientRow[];
  clientMonthly: Map<string, ClientMonthlyRow[]>;
  kpis: {
    totalVentas: number;
    cantClientes: number;
    ticketPromedio: number;
    pctPublico: number;
  };
}

export async function fetchServicios(): Promise<ServiciosData> {
  // Use server-side RPCs to avoid Supabase 1000-row limit
  const [{ data: monthlyRaw, error: e1 }, { data: clientesRaw, error: e2 }] = await Promise.all([
    supabase.rpc("get_servicios_mensual"),
    supabase.rpc("get_servicios_clientes"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  type MonthlyRow = { periodo: string; publico: number; privado: number; total: number; tx_count: number };
  type ClienteRow = {
    cuit: string; nombre: string; tipo_entidad: string; clasificacion: string;
    monto: number; cant_facturas: number;
    detalle_mensual: { periodo: string; monto: number; txCount: number }[];
  };

  const monthlyRows = (monthlyRaw ?? []) as MonthlyRow[];
  const clienteRows = (clientesRaw ?? []) as ClienteRow[];

  const monthly: ServiciosMonthly[] = monthlyRows
    .map((r) => ({
      periodo: String(r.periodo),
      publico: Number(r.publico) || 0,
      privado: Number(r.privado) || 0,
      total: Number(r.total) || 0,
      txCount: Number(r.tx_count) || 0,
    }))
    .filter((r) => r.periodo >= ECONOMICO_MIN_PERIODO);

  let totalMonto = 0;
  let totalFacturas = 0;
  const clientMonthly = new Map<string, ClientMonthlyRow[]>();

  const clients: ServiciosClientRow[] = clienteRows.map((r) => {
    const monto = Number(r.monto) || 0;
    const cantFacturas = Number(r.cant_facturas) || 0;
    totalMonto += monto;
    totalFacturas += cantFacturas;

    // Parse monthly detail from JSONB
    const detalle = Array.isArray(r.detalle_mensual) ? r.detalle_mensual : [];
    const monthlyRows: ClientMonthlyRow[] = detalle
      .map((d) => ({
        periodo: String(d.periodo),
        monto: Number(d.monto) || 0,
        txCount: Number(d.txCount) || 0,
      }))
      .filter((d) => d.periodo >= ECONOMICO_MIN_PERIODO);
    clientMonthly.set(String(r.cuit), monthlyRows);

    return {
      cuit: String(r.cuit),
      nombre: String(r.nombre),
      tipoEntidad: String(r.tipo_entidad),
      clasificacion: String(r.clasificacion),
      monto,
      cantFacturas,
      pct: 0, // calculated below
    };
  });

  // Calculate percentages after totals are known
  for (const c of clients) {
    c.pct = totalMonto > 0 ? (c.monto / totalMonto) * 100 : 0;
  }

  const totalPublico = monthly.reduce((s, r) => s + r.publico, 0);

  return {
    monthly,
    clients,
    clientMonthly,
    kpis: {
      totalVentas: totalMonto,
      cantClientes: clients.length,
      ticketPromedio: totalFacturas > 0 ? totalMonto / totalFacturas : 0,
      pctPublico: totalMonto > 0 ? (totalPublico / totalMonto) * 100 : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Heatmap helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function dayName(day: number): string {
  return DAY_NAMES[day] ?? String(day);
}

export function hourLabel(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

// ---------------------------------------------------------------------------
// Servicios — Tipo de servicio (desglose por línea de factura)
// Populated from factura_emitida_detalle, via RPCs get_servicios_tipo_mensual,
// get_servicios_top_descripciones, get_servicios_cliente_tipo.
// Header imp_neto_gravado_total is allocated across detalle lines in
// proportion to detalle.importe so totals match the rest of the page.
// ---------------------------------------------------------------------------

export interface TipoServicioMensualRow {
  periodo: string;
  tipoServicio: string;
  montoNeto: number;
  cantidad: number;
  lineas: number;
}

export interface TopDescripcionRow {
  descripcion: string;
  tipoServicio: string;
  montoNeto: number;
  cantidad: number;
  lineas: number;
  clientes: number;
}

export interface ClienteTipoRow {
  cuit: string;
  nombre: string;
  tipoServicio: string;
  montoNeto: number;
  lineas: number;
}

export async function fetchServiciosTipoMensual(): Promise<TipoServicioMensualRow[]> {
  const { data, error } = await supabase.rpc("get_servicios_tipo_mensual");
  if (error) throw error;
  type Raw = { periodo: string; tipo_servicio: string; monto_neto: number; cantidad: number; lineas: number };
  return ((data ?? []) as Raw[]).map((r) => ({
    periodo: String(r.periodo),
    tipoServicio: String(r.tipo_servicio),
    montoNeto: Number(r.monto_neto) || 0,
    cantidad: Number(r.cantidad) || 0,
    lineas: Number(r.lineas) || 0,
  }));
}

export async function fetchServiciosTopDescripciones(limit = 25, tipo?: string): Promise<TopDescripcionRow[]> {
  const params: Record<string, unknown> = { p_limit: limit };
  if (tipo) params.p_tipo = tipo;
  const { data, error } = await supabase.rpc("get_servicios_top_descripciones", params);
  if (error) throw error;
  type Raw = { descripcion: string; tipo_servicio: string; monto_neto: number; cantidad: number; lineas: number; clientes: number };
  return ((data ?? []) as Raw[]).map((r) => ({
    descripcion: String(r.descripcion),
    tipoServicio: String(r.tipo_servicio),
    montoNeto: Number(r.monto_neto) || 0,
    cantidad: Number(r.cantidad) || 0,
    lineas: Number(r.lineas) || 0,
    clientes: Number(r.clientes) || 0,
  }));
}

export interface TopRenglonRow {
  numero: number;
  montoNeto: number;
  cantidad: number;
  lineas: number;
  clientes: number;
  ejemplo: string;
}

export async function fetchServiciosTopRenglones(limit = 25): Promise<TopRenglonRow[]> {
  const { data, error } = await supabase.rpc("get_servicios_top_renglones", { p_limit: limit });
  if (error) throw error;
  type Raw = { numero: number; monto_neto: number; cantidad: number; lineas: number; clientes: number; ejemplo: string };
  return ((data ?? []) as Raw[]).map((r) => ({
    numero: Number(r.numero) || 0,
    montoNeto: Number(r.monto_neto) || 0,
    cantidad: Number(r.cantidad) || 0,
    lineas: Number(r.lineas) || 0,
    clientes: Number(r.clientes) || 0,
    ejemplo: String(r.ejemplo ?? ""),
  }));
}

export async function fetchServiciosClienteTipo(): Promise<ClienteTipoRow[]> {
  const { data, error } = await supabase.rpc("get_servicios_cliente_tipo");
  if (error) throw error;
  type Raw = { cuit: string; nombre: string; tipo_servicio: string; monto_neto: number; lineas: number };
  return ((data ?? []) as Raw[]).map((r) => ({
    cuit: String(r.cuit),
    nombre: String(r.nombre),
    tipoServicio: String(r.tipo_servicio),
    montoNeto: Number(r.monto_neto) || 0,
    lineas: Number(r.lineas) || 0,
  }));
}

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
  return ((data ?? []) as { periodo: string; monto: number; cantidad: number; tx_count: number }[])
    .map((r) => ({
      periodo: r.periodo,
      monto: Number(r.monto) || 0,
      cantidad: Number(r.cantidad) || 0,
      txCount: Number(r.tx_count) || 0,
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

// ---------------------------------------------------------------------------
// 3. Restobar — Similar to mostrador but filtered to restobar items
// ---------------------------------------------------------------------------

export interface RestobarData {
  monthly: { periodo: string; monto: number; cantidad: number; txCount: number }[];
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

  const monthly = ((mensualRes.data ?? []) as { periodo: string; monto: number; cantidad: number; tx_count: number }[])
    .map((r) => ({
      periodo: r.periodo,
      monto: Number(r.monto) || 0,
      cantidad: Number(r.cantidad) || 0,
      txCount: Number(r.tx_count) || 0,
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

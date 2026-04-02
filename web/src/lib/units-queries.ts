/**
 * Queries for the Unidades de Negocio module.
 * Resumen, Mostrador, Restobar, Servicios, Decoración.
 */
import { supabase } from "./supabase";
import { formatARS, formatPct, pctDelta, periodoLabel, shortLabel } from "./economic-queries";

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
    .sort((a, b) => a.periodo.localeCompare(b.periodo));

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
    .sort((a, b) => a.periodo.localeCompare(b.periodo));
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
  const { data: detalle, error: e1 } = await supabase
    .from("venta_detalle")
    .select("producto, neto, cantidad, venta:venta_id(fecha, monto_total)");
  if (e1) throw e1;

  const monthlyMap = new Map<string, { monto: number; cantidad: number; ventas: Set<string> }>();
  const heatmapMap = new Map<string, { monto: number; count: number }>();
  let totalMonto = 0;
  const allVentas = new Set<string>();

  if (detalle) {
    for (const d of detalle) {
      const prod = (d.producto ?? "").toLowerCase();
      if (prod !== "restobar") continue; // only restobar

      const ventaRaw = d.venta as unknown;
      const venta = Array.isArray(ventaRaw) ? ventaRaw[0] as { fecha: string; monto_total: number } | undefined : ventaRaw as { fecha: string; monto_total: number } | null;
      if (!venta) continue;

      const monto = Number(d.neto) || 0;
      const cantidad = Number(d.cantidad) || 0;
      const periodo = venta.fecha.slice(0, 7);
      const ventaKey = venta.fecha;

      // Monthly
      if (!monthlyMap.has(periodo)) monthlyMap.set(periodo, { monto: 0, cantidad: 0, ventas: new Set() });
      const mm = monthlyMap.get(periodo)!;
      mm.monto += monto;
      mm.cantidad += cantidad;
      mm.ventas.add(ventaKey);

      // Heatmap
      const dt = new Date(venta.fecha);
      const day = dt.getUTCDay();
      const hour = dt.getUTCHours();
      const hKey = `${day}|${hour}`;
      if (!heatmapMap.has(hKey)) heatmapMap.set(hKey, { monto: 0, count: 0 });
      const hc = heatmapMap.get(hKey)!;
      hc.monto += monto;
      hc.count += 1;

      totalMonto += monto;
      allVentas.add(ventaKey);
    }
  }

  const monthly = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, v]) => ({ periodo, monto: v.monto, cantidad: v.cantidad, txCount: v.ventas.size }));

  // Find best month
  let mesTop = "—";
  let mesTopMonto = 0;
  for (const m of monthly) {
    if (m.monto > mesTopMonto) {
      mesTopMonto = m.monto;
      mesTop = periodoLabel(m.periodo);
    }
  }

  return {
    monthly,
    heatmap: Array.from(heatmapMap.entries()).map(([key, v]) => {
      const [day, hour] = key.split("|").map(Number);
      return { day, hour, monto: v.monto, count: v.count };
    }),
    kpis: {
      totalVentas: totalMonto,
      ticketPromedio: allVentas.size > 0 ? totalMonto / allVentas.size : 0,
      mesTop,
      txTotal: allVentas.size,
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

export interface ServiciosData {
  monthly: { periodo: string; publico: number; privado: number; total: number }[];
  clients: ServiciosClientRow[];
  kpis: {
    totalVentas: number;
    cantClientes: number;
    ticketPromedio: number;
    pctPublico: number;
  };
}

export async function fetchServicios(): Promise<ServiciosData> {
  // factura_emitida PV 6 = Servicios/Catering only
  const { data: facturas, error: e1 } = await supabase
    .from("factura_emitida")
    .select("fecha_emision, imp_neto_gravado_total, nro_doc_receptor, tipo_comprobante")
    .eq("punto_venta", 6);
  if (e1) throw e1;

  // clients with segmentation
  const { data: clientes, error: e2 } = await supabase
    .from("cliente")
    .select("cuit, razon_social, tipo_entidad, clasificacion");
  if (e2) throw e2;

  const clienteMap = new Map<string, { nombre: string; tipoEntidad: string; clasificacion: string }>();
  if (clientes) {
    for (const c of clientes) {
      clienteMap.set(c.cuit as string, {
        nombre: (c.razon_social ?? "Sin nombre") as string,
        tipoEntidad: (c.tipo_entidad ?? "Sin clasificar") as string,
        clasificacion: (c.clasificacion ?? "Sin clasificar") as string,
      });
    }
  }

  const monthlyPub = new Map<string, number>();
  const monthlyPriv = new Map<string, number>();
  const clientAgg = new Map<string, { monto: number; count: number }>();
  let totalMonto = 0;

  if (facturas) {
    for (const f of facturas) {
      const raw = Number(f.imp_neto_gravado_total) || 0;
      const monto = [3, 8, 203].includes(Number(f.tipo_comprobante)) ? -raw : raw;
      const periodo = (f.fecha_emision as string).slice(0, 7);
      const cuit = (f.nro_doc_receptor ?? "") as string;
      const cli = clienteMap.get(cuit);
      const tipo = cli?.tipoEntidad ?? "Sin clasificar";

      if (tipo.toLowerCase().includes("público") || tipo.toLowerCase().includes("publico")) {
        monthlyPub.set(periodo, (monthlyPub.get(periodo) ?? 0) + monto);
      } else {
        monthlyPriv.set(periodo, (monthlyPriv.get(periodo) ?? 0) + monto);
      }

      if (!clientAgg.has(cuit)) clientAgg.set(cuit, { monto: 0, count: 0 });
      const ca = clientAgg.get(cuit)!;
      ca.monto += monto;
      ca.count += 1;

      totalMonto += monto;
    }
  }

  const allP = new Set<string>();
  monthlyPub.forEach((_, k) => allP.add(k));
  monthlyPriv.forEach((_, k) => allP.add(k));

  const monthly = Array.from(allP).sort().map((p) => {
    const publico = monthlyPub.get(p) ?? 0;
    const privado = monthlyPriv.get(p) ?? 0;
    return { periodo: p, publico, privado, total: publico + privado };
  });

  // Client ranking
  const clients: ServiciosClientRow[] = Array.from(clientAgg.entries())
    .map(([cuit, v]) => {
      const cli = clienteMap.get(cuit);
      return {
        cuit,
        nombre: cli?.nombre ?? cuit,
        tipoEntidad: cli?.tipoEntidad ?? "Sin clasificar",
        clasificacion: cli?.clasificacion ?? "Sin clasificar",
        monto: v.monto,
        cantFacturas: v.count,
        pct: totalMonto > 0 ? (v.monto / totalMonto) * 100 : 0,
      };
    })
    .sort((a, b) => b.monto - a.monto);

  const totalPublico = monthly.reduce((s, r) => s + r.publico, 0);

  return {
    monthly,
    clients,
    kpis: {
      totalVentas: totalMonto,
      cantClientes: clientAgg.size,
      ticketPromedio: facturas ? (facturas.length > 0 ? totalMonto / facturas.length : 0) : 0,
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

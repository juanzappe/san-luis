/**
 * Queries for the Comercial module.
 * Clientes, Proveedores, Segmentación.
 *
 * Uses server-side RPCs to avoid fetching full tables (93k+ rows)
 * which caused timeouts and silent truncation at 1000 rows.
 */
import { supabase } from "./supabase";
import { fetchWithRetry } from "./fetchWithRetry";
import { formatARS, formatPct, pctDelta, periodoLabel, shortLabel } from "./economic-queries";

export { formatARS, formatPct, pctDelta, periodoLabel, shortLabel };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addToMap(map: Map<string, number>, key: string, val: number) {
  map.set(key, (map.get(key) ?? 0) + val);
}

// ---------------------------------------------------------------------------
// 1. Clientes
// ---------------------------------------------------------------------------

export interface ClienteRanking {
  cuit: string;
  nombre: string;
  tipoEntidad: string;
  clasificacion: string;
  facturacionTotal: number;
  cantFacturas: number;
  ticketPromedio: number;
  pctTotal: number;
  pctAcumulado: number;
}

export interface ClienteMensual {
  periodo: string;
  monto: number;
  cantClientes: number;
  montoPublico: number;
  montoPrivado: number;
}

export interface ClienteDetalle {
  nombre: string;
  cuit: string;
  tipoEntidad: string;
  clasificacion: string;
  mensual: { periodo: string; monto: number; cantFacturas: number }[];
  frecuenciaDias: number | null;
}

export interface ClientesData {
  ranking: ClienteRanking[];
  mensual: ClienteMensual[];
  concentracionTop10: number;
  pctPublico: number;
  porTipoEntidad: { name: string; value: number }[];
  porClasificacion: { name: string; value: number }[];
  concentracionDonut: { name: string; value: number }[];
}

// RPC row type for get_comercial_clientes
type RpcClienteRow = {
  periodo: string;
  cuit: string;
  denominacion: string;
  total_neto: number;
  cantidad: number;
  tipo_comprobante: number;
  tipo_entidad: string;
  clasificacion: string;
};

export async function fetchClientes(): Promise<ClientesData> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_comercial_clientes");
    if (res.error) throw res.error;
    return res.data;
  });

  const rows = (data ?? []) as RpcClienteRow[];

  // Aggregate by client (CUIT), applying credit note sign reversal
  const clientTotals = new Map<string, { nombre: string; monto: number; cnt: number; tipoEntidad: string; clasificacion: string }>();
  const monthlyMap = new Map<string, { monto: number; clientes: Set<string>; publico: number; privado: number }>();

  for (const r of rows) {
    const raw = Number(r.total_neto) || 0;
    const monto = [3, 8, 203].includes(Number(r.tipo_comprobante)) ? -raw : raw;
    if (monto <= 0) continue;
    const cnt = Number(r.cantidad) || 0;
    const cuit = r.cuit;
    const tipoEntidad = r.tipo_entidad;
    const clasificacion = r.clasificacion;

    // Client total
    const existing = clientTotals.get(cuit);
    if (existing) {
      existing.monto += monto;
      existing.cnt += cnt;
    } else {
      clientTotals.set(cuit, {
        nombre: r.denominacion,
        monto,
        cnt,
        tipoEntidad,
        clasificacion,
      });
    }

    // Monthly
    const periodo = r.periodo;
    if (!monthlyMap.has(periodo)) {
      monthlyMap.set(periodo, { monto: 0, clientes: new Set(), publico: 0, privado: 0 });
    }
    const mm = monthlyMap.get(periodo)!;
    mm.monto += monto;
    mm.clientes.add(cuit);
    if (tipoEntidad.toLowerCase().includes("públ") || tipoEntidad.toLowerCase().includes("publ")) {
      mm.publico += monto;
    } else {
      mm.privado += monto;
    }
  }

  // Build ranking
  const grandTotal = Array.from(clientTotals.values()).reduce((s, c) => s + c.monto, 0);
  const sorted = Array.from(clientTotals.entries())
    .map(([cuit, c]) => ({ cuit, ...c }))
    .sort((a, b) => b.monto - a.monto);

  let acum = 0;
  const ranking: ClienteRanking[] = sorted.map((c) => {
    const pct = grandTotal > 0 ? (c.monto / grandTotal) * 100 : 0;
    acum += pct;
    return {
      cuit: c.cuit,
      nombre: c.nombre,
      tipoEntidad: c.tipoEntidad,
      clasificacion: c.clasificacion,
      facturacionTotal: c.monto,
      cantFacturas: c.cnt,
      ticketPromedio: c.cnt > 0 ? c.monto / c.cnt : 0,
      pctTotal: pct,
      pctAcumulado: acum,
    };
  });

  // Concentration
  const top5 = ranking.slice(0, 5).reduce((s, c) => s + c.facturacionTotal, 0);
  const top6_10 = ranking.slice(5, 10).reduce((s, c) => s + c.facturacionTotal, 0);
  const top10 = top5 + top6_10;
  const rest = grandTotal - top10;
  const concentracionTop10 = grandTotal > 0 ? (top10 / grandTotal) * 100 : 0;

  const concentracionDonut = [
    { name: "Top 5", value: top5 },
    { name: "Top 6-10", value: top6_10 },
    { name: "Resto", value: rest },
  ].filter((d) => d.value > 0);

  // By TipoEntidad
  const byTipo = new Map<string, number>();
  const byClasif = new Map<string, number>();
  for (const c of sorted) {
    addToMap(byTipo, c.tipoEntidad, c.monto);
    addToMap(byClasif, c.clasificacion, c.monto);
  }
  const porTipoEntidad = Array.from(byTipo.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const porClasificacion = Array.from(byClasif.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  const pctPublico = grandTotal > 0
    ? (porTipoEntidad.find((t) => t.name.toLowerCase().includes("públ") || t.name.toLowerCase().includes("publ"))?.value ?? 0) / grandTotal * 100
    : 0;

  // Monthly
  const mensual: ClienteMensual[] = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periodo, m]) => ({
      periodo,
      monto: m.monto,
      cantClientes: m.clientes.size,
      montoPublico: m.publico,
      montoPrivado: m.privado,
    }));

  return { ranking, mensual, concentracionTop10, pctPublico, porTipoEntidad, porClasificacion, concentracionDonut };
}

// RPC row type for get_detalle_cliente / get_detalle_proveedor
type RpcDetalleRow = {
  periodo: string;
  total_neto: number;
  cantidad: number;
  tipo_comprobante: number;
  primera_fecha: string;
  ultima_fecha: string;
  cant_fechas_distintas: number;
};

export async function fetchClienteDetalle(cuit: string): Promise<ClienteDetalle | null> {
  const [rpcRes, cliRes] = await Promise.all([
    fetchWithRetry(async () => {
      const res = await supabase.rpc("get_detalle_cliente", { p_cuit: cuit });
      if (res.error) throw res.error;
      return res.data;
    }),
    supabase.from("cliente").select("razon_social, cuit, tipo_entidad, clasificacion").eq("cuit", cuit).limit(1),
  ]);

  const rows = (rpcRes ?? []) as RpcDetalleRow[];
  if (rows.length === 0) return null;

  const cli = (cliRes.data ?? [])[0];
  const nombre = (cli?.razon_social as string) ?? cuit;
  const tipoEntidad = (cli?.tipo_entidad as string) ?? "Sin clasificar";
  const clasificacion = (cli?.clasificacion as string) ?? "Sin clasificar";

  // Monthly aggregation from pre-grouped RPC rows
  const monthMap = new Map<string, { monto: number; cnt: number }>();
  let totalDates = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of rows) {
    const raw = Number(r.total_neto) || 0;
    const monto = [3, 8, 203].includes(Number(r.tipo_comprobante)) ? -raw : raw;
    const cnt = Number(r.cantidad) || 0;
    const p = r.periodo;

    const m = monthMap.get(p) ?? { monto: 0, cnt: 0 };
    m.monto += monto;
    m.cnt += cnt;
    monthMap.set(p, m);

    totalDates += Number(r.cant_fechas_distintas) || 0;
    if (!minDate || r.primera_fecha < minDate) minDate = r.primera_fecha;
    if (!maxDate || r.ultima_fecha > maxDate) maxDate = r.ultima_fecha;
  }

  // Frequency: approximate from date range and distinct dates
  let frecuenciaDias: number | null = null;
  if (totalDates >= 2 && minDate && maxDate) {
    const totalDiff = (new Date(maxDate).getTime() - new Date(minDate).getTime()) / (1000 * 60 * 60 * 24);
    frecuenciaDias = Math.round(totalDiff / (totalDates - 1));
  }

  const mensual = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periodo, m]) => ({ periodo, monto: m.monto, cantFacturas: m.cnt }));

  return { nombre, cuit, tipoEntidad, clasificacion, mensual, frecuenciaDias };
}

// ---------------------------------------------------------------------------
// 2. Proveedores
// ---------------------------------------------------------------------------

export interface ProveedorRanking {
  cuit: string;
  nombre: string;
  tipoCosto: string;
  categoriaEgreso: string;
  montoTotal: number;
  cantFacturas: number;
  compraPromedio: number;
  pctTotal: number;
  pctAcumulado: number;
}

export interface ProveedorMensual {
  periodo: string;
  monto: number;
  cantProveedores: number;
  porCategoria: Record<string, number>;
}

export interface ProveedorDetalle {
  nombre: string;
  cuit: string;
  tipoCosto: string;
  categoriaEgreso: string;
  mensual: { periodo: string; monto: number; cantFacturas: number; promedioFactura: number }[];
  frecuenciaDias: number | null;
}

export interface ProveedoresData {
  ranking: ProveedorRanking[];
  mensual: ProveedorMensual[];
  concentracionTop10: number;
  porTipoCosto: { name: string; value: number }[];
  porCategoriaEgreso: { name: string; value: number }[];
  concentracionDonut: { name: string; value: number }[];
}

// RPC row type for get_comercial_proveedores
type RpcProveedorRow = {
  periodo: string;
  cuit: string;
  denominacion: string;
  total_neto: number;
  cantidad: number;
  tipo_comprobante: number;
  tipo_costo: string;
  categoria_egreso: string;
};

export async function fetchProveedores(): Promise<ProveedoresData> {
  const data = await fetchWithRetry(async () => {
    const res = await supabase.rpc("get_comercial_proveedores");
    if (res.error) throw res.error;
    return res.data;
  });

  const rows = (data ?? []) as RpcProveedorRow[];

  // Aggregate by proveedor
  const provTotals = new Map<string, { nombre: string; monto: number; cnt: number; tipoCosto: string; categoriaEgreso: string }>();
  const monthlyMap = new Map<string, { monto: number; proveedores: Set<string>; porCat: Map<string, number> }>();

  for (const r of rows) {
    const raw = Number(r.total_neto) || 0;
    const monto = [3, 8, 203].includes(Number(r.tipo_comprobante)) ? -raw : raw;
    if (monto <= 0) continue;
    const cnt = Number(r.cantidad) || 0;
    const cuit = r.cuit;
    const categoriaEgreso = r.categoria_egreso;

    const existing = provTotals.get(cuit);
    if (existing) {
      existing.monto += monto;
      existing.cnt += cnt;
    } else {
      provTotals.set(cuit, {
        nombre: r.denominacion,
        monto,
        cnt,
        tipoCosto: r.tipo_costo,
        categoriaEgreso,
      });
    }

    const periodo = r.periodo;
    if (!monthlyMap.has(periodo)) {
      monthlyMap.set(periodo, { monto: 0, proveedores: new Set(), porCat: new Map() });
    }
    const mm = monthlyMap.get(periodo)!;
    mm.monto += monto;
    mm.proveedores.add(cuit);
    addToMap(mm.porCat, categoriaEgreso, monto);
  }

  // Ranking
  const grandTotal = Array.from(provTotals.values()).reduce((s, p) => s + p.monto, 0);
  const sorted = Array.from(provTotals.entries())
    .map(([cuit, p]) => ({ cuit, ...p }))
    .sort((a, b) => b.monto - a.monto);

  let acum = 0;
  const ranking: ProveedorRanking[] = sorted.map((p) => {
    const pct = grandTotal > 0 ? (p.monto / grandTotal) * 100 : 0;
    acum += pct;
    return {
      cuit: p.cuit,
      nombre: p.nombre,
      tipoCosto: p.tipoCosto,
      categoriaEgreso: p.categoriaEgreso,
      montoTotal: p.monto,
      cantFacturas: p.cnt,
      compraPromedio: p.cnt > 0 ? p.monto / p.cnt : 0,
      pctTotal: pct,
      pctAcumulado: acum,
    };
  });

  // Concentration
  const top5 = ranking.slice(0, 5).reduce((s, p) => s + p.montoTotal, 0);
  const top6_10 = ranking.slice(5, 10).reduce((s, p) => s + p.montoTotal, 0);
  const top10 = top5 + top6_10;
  const concentracionTop10 = grandTotal > 0 ? (top10 / grandTotal) * 100 : 0;

  const concentracionDonut = [
    { name: "Top 5", value: top5 },
    { name: "Top 6-10", value: top6_10 },
    { name: "Resto", value: grandTotal - top10 },
  ].filter((d) => d.value > 0);

  // By TipoCosto and CategoriaEgreso
  const byTipo = new Map<string, number>();
  const byCat = new Map<string, number>();
  for (const p of sorted) {
    addToMap(byTipo, p.tipoCosto, p.monto);
    addToMap(byCat, p.categoriaEgreso, p.monto);
  }
  const porTipoCosto = Array.from(byTipo.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const porCategoriaEgreso = Array.from(byCat.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // Monthly
  const mensual: ProveedorMensual[] = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periodo, m]) => {
      const porCategoria: Record<string, number> = {};
      m.porCat.forEach((v, k) => { porCategoria[k] = v; });
      return { periodo, monto: m.monto, cantProveedores: m.proveedores.size, porCategoria };
    });

  return { ranking, mensual, concentracionTop10, porTipoCosto, porCategoriaEgreso, concentracionDonut };
}

export async function fetchProveedorDetalle(cuit: string): Promise<ProveedorDetalle | null> {
  const [rpcRes, provRes] = await Promise.all([
    fetchWithRetry(async () => {
      const res = await supabase.rpc("get_detalle_proveedor", { p_cuit: cuit });
      if (res.error) throw res.error;
      return res.data;
    }),
    supabase.from("proveedor").select("razon_social, cuit, tipo_costo, categoria_egreso").eq("cuit", cuit).limit(1),
  ]);

  const rows = (rpcRes ?? []) as RpcDetalleRow[];
  if (rows.length === 0) return null;

  const prov = (provRes.data ?? [])[0];
  const nombre = (prov?.razon_social as string) ?? cuit;
  const tipoCosto = (prov?.tipo_costo as string) ?? "Sin clasificar";
  const categoriaEgreso = (prov?.categoria_egreso as string) ?? "Sin clasificar";

  const monthMap = new Map<string, { monto: number; cnt: number }>();
  let totalDates = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of rows) {
    const raw = Number(r.total_neto) || 0;
    const monto = [3, 8, 203].includes(Number(r.tipo_comprobante)) ? -raw : raw;
    const cnt = Number(r.cantidad) || 0;
    const p = r.periodo;

    const m = monthMap.get(p) ?? { monto: 0, cnt: 0 };
    m.monto += monto;
    m.cnt += cnt;
    monthMap.set(p, m);

    totalDates += Number(r.cant_fechas_distintas) || 0;
    if (!minDate || r.primera_fecha < minDate) minDate = r.primera_fecha;
    if (!maxDate || r.ultima_fecha > maxDate) maxDate = r.ultima_fecha;
  }

  let frecuenciaDias: number | null = null;
  if (totalDates >= 2 && minDate && maxDate) {
    const totalDiff = (new Date(maxDate).getTime() - new Date(minDate).getTime()) / (1000 * 60 * 60 * 24);
    frecuenciaDias = Math.round(totalDiff / (totalDates - 1));
  }

  const mensual = Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periodo, m]) => ({ periodo, monto: m.monto, cantFacturas: m.cnt, promedioFactura: m.cnt > 0 ? m.monto / m.cnt : 0 }));

  return { nombre, cuit, tipoCosto, categoriaEgreso, mensual, frecuenciaDias };
}

// ---------------------------------------------------------------------------
// 3. Segmentación — ABC Analysis
// ---------------------------------------------------------------------------

export interface AbcGroup {
  label: string;
  clientes: { nombre: string; cuit: string; monto: number; pct: number }[];
  totalMonto: number;
  totalPct: number;
  count: number;
}

export function calcAbcGroups(ranking: { nombre: string; cuit: string; facturacionTotal?: number; montoTotal?: number; pctAcumulado: number }[]): AbcGroup[] {
  const a: AbcGroup = { label: "A (80%)", clientes: [], totalMonto: 0, totalPct: 0, count: 0 };
  const b: AbcGroup = { label: "B (15%)", clientes: [], totalMonto: 0, totalPct: 0, count: 0 };
  const c: AbcGroup = { label: "C (5%)", clientes: [], totalMonto: 0, totalPct: 0, count: 0 };

  for (const r of ranking) {
    const monto = r.facturacionTotal ?? r.montoTotal ?? 0;
    const entry = { nombre: r.nombre, cuit: r.cuit, monto, pct: 0 };
    if (r.pctAcumulado <= 80) {
      a.clientes.push(entry);
      a.totalMonto += monto;
      a.count += 1;
    } else if (r.pctAcumulado <= 95) {
      b.clientes.push(entry);
      b.totalMonto += monto;
      b.count += 1;
    } else {
      c.clientes.push(entry);
      c.totalMonto += monto;
      c.count += 1;
    }
  }

  const grandTotal = a.totalMonto + b.totalMonto + c.totalMonto;
  for (const g of [a, b, c]) {
    g.totalPct = grandTotal > 0 ? (g.totalMonto / grandTotal) * 100 : 0;
    for (const cl of g.clientes) {
      cl.pct = grandTotal > 0 ? (cl.monto / grandTotal) * 100 : 0;
    }
  }

  return [a, b, c];
}

// ---------------------------------------------------------------------------
// Segmentation catalogs
// ---------------------------------------------------------------------------

export interface CatalogRow {
  id: number;
  nombre: string;
  extra?: string;
}

export async function fetchCatalogoCategorias(): Promise<CatalogRow[]> {
  const { data, error } = await supabase
    .from("categoria_egreso")
    .select("id, nombre, tipo_costo")
    .order("nombre");
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id as number, nombre: r.nombre as string, extra: r.tipo_costo as string }));
}

export async function fetchCatalogoSectores(): Promise<CatalogRow[]> {
  const { data, error } = await supabase
    .from("sector_cliente")
    .select("id, nombre")
    .order("nombre");
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id as number, nombre: r.nombre as string }));
}

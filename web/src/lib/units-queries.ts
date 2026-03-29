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

export interface ProductRow {
  producto: string;
  familia: string;
  monto: number;
  cantidad: number;
  pct: number;
}

export interface FamilyRow {
  familia: string;
  monto: number;
  pct: number;
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
  // POS: venta_detalle with venta.fecha — split mostrador vs restobar
  const { data: detalle, error: e1 } = await supabase
    .from("venta_detalle")
    .select("producto, neto, cantidad, venta:venta_id(fecha, monto_total)");
  if (e1) throw e1;

  // Servicios: factura_emitida PV 6 only (neto, no IVA)
  //   PV 8 = Mostrador (ya capturado en venta_detalle), PV 998 = pendiente
  const { data: facturas, error: e2 } = await supabase
    .from("factura_emitida")
    .select("fecha_emision, imp_neto_gravado_total")
    .eq("punto_venta", 6);
  if (e2) throw e2;

  const mostradorMap = new Map<string, number>();
  const restobarMap = new Map<string, number>();
  let mostradorTxCount = 0;
  let restobarTxCount = 0;
  const mostradorVentas = new Set<string>();
  const restobarVentas = new Set<string>();

  if (detalle) {
    for (const d of detalle) {
      const ventaRaw = d.venta as unknown;
      const venta = Array.isArray(ventaRaw) ? ventaRaw[0] as { fecha: string; monto_total: number } | undefined : ventaRaw as { fecha: string; monto_total: number } | null;
      if (!venta) continue;
      const p = venta.fecha.slice(0, 7);
      const monto = Number(d.neto) || 0;
      const prod = (d.producto ?? "").toLowerCase();
      if (prod === "restobar") {
        restobarMap.set(p, (restobarMap.get(p) ?? 0) + monto);
        restobarVentas.add(`${venta.fecha}`);
      } else {
        mostradorMap.set(p, (mostradorMap.get(p) ?? 0) + monto);
        mostradorVentas.add(`${venta.fecha}`);
      }
    }
  }
  mostradorTxCount = mostradorVentas.size;
  restobarTxCount = restobarVentas.size;

  const serviciosMap = new Map<string, number>();
  let serviciosTxCount = 0;
  if (facturas) {
    for (const f of facturas) {
      const p = (f.fecha_emision as string).slice(0, 7);
      serviciosMap.set(p, (serviciosMap.get(p) ?? 0) + (Number(f.imp_neto_gravado_total) || 0));
      serviciosTxCount++;
    }
  }

  const allP = new Set<string>();
  for (const m of [mostradorMap, restobarMap, serviciosMap]) {
    m.forEach((_, k) => allP.add(k));
  }

  const monthly = Array.from(allP).sort().map((p) => {
    const mostrador = mostradorMap.get(p) ?? 0;
    const restobar = restobarMap.get(p) ?? 0;
    const servicios = serviciosMap.get(p) ?? 0;
    return { periodo: p, mostrador, restobar, servicios, total: mostrador + restobar + servicios };
  });

  const totalMostrador = monthly.reduce((s, r) => s + r.mostrador, 0);
  const totalRestobar = monthly.reduce((s, r) => s + r.restobar, 0);
  const totalServicios = monthly.reduce((s, r) => s + r.servicios, 0);

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
// 2. Mostrador — Product mix, families, heatmap
// ---------------------------------------------------------------------------

export interface MostradorData {
  monthly: { periodo: string; monto: number; cantidad: number; txCount: number }[];
  products: ProductRow[];
  families: FamilyRow[];
  heatmap: HeatmapCell[];
  kpis: {
    totalVentas: number;
    ticketPromedio: number;
    topProducto: string;
    topFamilia: string;
  };
}

export async function fetchMostrador(): Promise<MostradorData> {
  const { data: detalle, error: e1 } = await supabase
    .from("venta_detalle")
    .select("producto, familia, neto, cantidad, venta:venta_id(fecha, monto_total)");
  if (e1) throw e1;

  const monthlyMap = new Map<string, { monto: number; cantidad: number; ventas: Set<string> }>();
  const productMap = new Map<string, { familia: string; monto: number; cantidad: number }>();
  const heatmapMap = new Map<string, { monto: number; count: number }>();
  let totalMonto = 0;
  const allVentas = new Set<string>();

  if (detalle) {
    for (const d of detalle) {
      const prod = (d.producto ?? "").toLowerCase();
      if (prod === "restobar") continue; // exclude restobar

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

      // Products
      const prodName = d.producto ?? "Sin nombre";
      const familia = d.familia ?? "Sin familia";
      if (!productMap.has(prodName)) productMap.set(prodName, { familia, monto: 0, cantidad: 0 });
      const pm = productMap.get(prodName)!;
      pm.monto += monto;
      pm.cantidad += cantidad;

      // Heatmap (day × hour)
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

  // Monthly array
  const monthly = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodo, v]) => ({ periodo, monto: v.monto, cantidad: v.cantidad, txCount: v.ventas.size }));

  // Products sorted by monto
  const products: ProductRow[] = Array.from(productMap.entries())
    .map(([producto, v]) => ({
      producto,
      familia: v.familia,
      monto: v.monto,
      cantidad: v.cantidad,
      pct: totalMonto > 0 ? (v.monto / totalMonto) * 100 : 0,
    }))
    .sort((a, b) => b.monto - a.monto);

  // Families
  const familyAgg = new Map<string, number>();
  for (const p of products) {
    familyAgg.set(p.familia, (familyAgg.get(p.familia) ?? 0) + p.monto);
  }
  const families: FamilyRow[] = Array.from(familyAgg.entries())
    .map(([familia, monto]) => ({ familia, monto, pct: totalMonto > 0 ? (monto / totalMonto) * 100 : 0 }))
    .sort((a, b) => b.monto - a.monto);

  // Heatmap
  const heatmap: HeatmapCell[] = Array.from(heatmapMap.entries()).map(([key, v]) => {
    const [day, hour] = key.split("|").map(Number);
    return { day, hour, monto: v.monto, count: v.count };
  });

  return {
    monthly,
    products,
    families,
    heatmap,
    kpis: {
      totalVentas: totalMonto,
      ticketPromedio: allVentas.size > 0 ? totalMonto / allVentas.size : 0,
      topProducto: products.length > 0 ? products[0].producto : "—",
      topFamilia: families.length > 0 ? families[0].familia : "—",
    },
  };
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
    .select("fecha_emision, imp_neto_gravado_total, nro_doc_receptor")
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
      const monto = Number(f.imp_neto_gravado_total) || 0;
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

/**
 * Queries for the Económico module (Ingresos, Egresos, Resultado).
 */
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const MONTH_NAMES = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

const SHORT_MONTHS = [
  "Ene","Feb","Mar","Abr","May","Jun",
  "Jul","Ago","Sep","Oct","Nov","Dic",
];

export function periodoLabel(p: string): string {
  const [y, m] = p.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

export function shortLabel(p: string): string {
  const [, m] = p.split("-");
  return SHORT_MONTHS[parseInt(m, 10) - 1] ?? m;
}

export function formatARS(n: number): string {
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function formatPct(n: number | null): string {
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function groupSum(
  rows: { periodo: string; monto: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.periodo, (map.get(r.periodo) ?? 0) + r.monto);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Ingresos by source
// ---------------------------------------------------------------------------

export interface IngresoRow {
  periodo: string;
  mostrador: number;
  restobar: number;
  servicios: number;
  total: number;
}

export async function fetchIngresos(): Promise<IngresoRow[]> {
  // 1) venta_detalle joined with venta for fecha — split mostrador vs restobar
  const { data: detalle, error: e1 } = await supabase
    .from("venta_detalle")
    .select("producto, neto, venta:venta_id(fecha)");
  if (e1) throw e1;

  // 2) factura_emitida for servicios (neto, no IVA)
  const { data: facturas, error: e2 } = await supabase
    .from("factura_emitida")
    .select("fecha_emision, imp_neto_gravado_total");
  if (e2) throw e2;

  const mostradorMap = new Map<string, number>();
  const restobarMap = new Map<string, number>();

  if (detalle) {
    for (const d of detalle) {
      // venta is a joined object { fecha: "..." }
      // Supabase returns FK joins as arrays or objects depending on cardinality
      const ventaRaw = d.venta as unknown;
      const venta = Array.isArray(ventaRaw) ? ventaRaw[0] as { fecha: string } | undefined : ventaRaw as { fecha: string } | null;
      if (!venta) continue;
      const p = venta.fecha.slice(0, 7);
      const monto = Number(d.neto) || 0;
      const prod = (d.producto ?? "").toLowerCase();
      if (prod === "restobar") {
        restobarMap.set(p, (restobarMap.get(p) ?? 0) + monto);
      } else {
        mostradorMap.set(p, (mostradorMap.get(p) ?? 0) + monto);
      }
    }
  }

  const serviciosMap = new Map<string, number>();
  if (facturas) {
    for (const f of facturas) {
      const p = (f.fecha_emision as string).slice(0, 7);
      serviciosMap.set(
        p,
        (serviciosMap.get(p) ?? 0) + (Number(f.imp_neto_gravado_total) || 0),
      );
    }
  }

  // Merge all periodos
  const allP = new Set<string>();
  for (const m of [mostradorMap, restobarMap, serviciosMap]) {
    m.forEach((_, k) => allP.add(k));
  }

  return Array.from(allP)
    .sort()
    .map((p) => {
      const mostrador = mostradorMap.get(p) ?? 0;
      const restobar = restobarMap.get(p) ?? 0;
      const servicios = serviciosMap.get(p) ?? 0;
      return {
        periodo: p,
        mostrador,
        restobar,
        servicios,
        total: mostrador + restobar + servicios,
      };
    });
}

// ---------------------------------------------------------------------------
// Egresos by cost structure
// ---------------------------------------------------------------------------

export interface EgresoRow {
  periodo: string;
  operativos: number; // sueldos + proveedores
  comerciales: number; // impuestos (no ganancias) + marketing + delivery
  financieros: number; // bank fees & interest
  ganancias: number; // imp. a las ganancias
  total: number;
}

export async function fetchEgresos(): Promise<EgresoRow[]> {
  // 1) Sueldos (costo_total_empresa for full employer cost)
  const { data: sueldos, error: e1 } = await supabase
    .from("liquidacion_sueldo")
    .select("periodo, costo_total_empresa, sueldo_neto");
  if (e1) throw e1;

  const sueldosMap = groupSum(
    (sueldos ?? []).map((s) => ({
      periodo: s.periodo.slice(0, 7),
      monto: Number(s.costo_total_empresa ?? s.sueldo_neto) || 0,
    })),
  );

  // 2) Proveedores operativos (factura_recibida neto — this is the bulk of opex)
  const { data: factRec, error: e2 } = await supabase
    .from("factura_recibida")
    .select("fecha_emision, imp_neto_gravado_total");
  if (e2) throw e2;

  const proveedoresMap = groupSum(
    (factRec ?? []).map((f) => ({
      periodo: (f.fecha_emision as string).slice(0, 7),
      monto: Number(f.imp_neto_gravado_total) || 0,
    })),
  );

  // 3) Impuestos — join pago_impuesto with impuesto_obligacion to get tipo
  const { data: pagos, error: e3 } = await supabase
    .from("pago_impuesto")
    .select("fecha_pago, monto, impuesto_obligacion:impuesto_obligacion_id(tipo)");
  if (e3) throw e3;

  const impComercialMap = new Map<string, number>();
  const gananciasMap = new Map<string, number>();

  if (pagos) {
    for (const pago of pagos) {
      const p = (pago.fecha_pago as string).slice(0, 7);
      const monto = Number(pago.monto) || 0;
      const oblRaw = pago.impuesto_obligacion as unknown;
      const obligacion = Array.isArray(oblRaw) ? oblRaw[0] as { tipo: string } | undefined : oblRaw as { tipo: string } | null;
      const tipo = obligacion?.tipo ?? "";
      if (tipo === "ganancias") {
        gananciasMap.set(p, (gananciasMap.get(p) ?? 0) + monto);
      } else {
        impComercialMap.set(p, (impComercialMap.get(p) ?? 0) + monto);
      }
    }
  }

  // 4) Bank fees (movimiento_bancario debits that are fees/interest)
  const { data: movBanco, error: e4 } = await supabase
    .from("movimiento_bancario")
    .select("fecha, concepto, debito");
  if (e4) throw e4;

  const financierosMap = new Map<string, number>();
  if (movBanco) {
    for (const m of movBanco) {
      const concepto = (m.concepto ?? "").toLowerCase();
      const debito = Number(m.debito) || 0;
      if (debito <= 0) continue;
      // Filter for financial costs: commissions, interest, fees
      if (
        concepto.includes("comision") ||
        concepto.includes("interes") ||
        concepto.includes("impuesto s/deb") ||
        concepto.includes("impuesto s/cred") ||
        concepto.includes("mantenimiento") ||
        concepto.includes("seguro") ||
        concepto.includes("sellado")
      ) {
        const p = (m.fecha as string).slice(0, 7);
        financierosMap.set(p, (financierosMap.get(p) ?? 0) + debito);
      }
    }
  }

  // Merge all periodos
  const allP = new Set<string>();
  for (const mp of [sueldosMap, proveedoresMap, impComercialMap, gananciasMap, financierosMap]) {
    mp.forEach((_, k) => allP.add(k));
  }

  return Array.from(allP)
    .sort()
    .map((p) => {
      const operativos = (sueldosMap.get(p) ?? 0) + (proveedoresMap.get(p) ?? 0);
      const comerciales = impComercialMap.get(p) ?? 0;
      const financieros = financierosMap.get(p) ?? 0;
      const ganancias = gananciasMap.get(p) ?? 0;
      return {
        periodo: p,
        operativos,
        comerciales,
        financieros,
        ganancias,
        total: operativos + comerciales + financieros + ganancias,
      };
    });
}

// ---------------------------------------------------------------------------
// Estado de Resultados — full P&L structure
// ---------------------------------------------------------------------------

export interface ResultadoRow {
  periodo: string;
  ingresos: number;
  costosOperativos: number;
  margenBruto: number;
  costosComercialesAdmin: number;
  costosFinancieros: number;
  resultadoAntesGanancias: number;
  ganancias: number;
  resultadoNeto: number;
  margenPct: number;
}

export async function fetchResultado(): Promise<ResultadoRow[]> {
  const [ingresos, egresos] = await Promise.all([
    fetchIngresos(),
    fetchEgresos(),
  ]);

  const ingMap = new Map(ingresos.map((r) => [r.periodo, r.total]));
  const egrMap = new Map(egresos.map((r) => [r.periodo, r]));

  const allP = new Set<string>();
  ingMap.forEach((_, k) => allP.add(k));
  egrMap.forEach((_, k) => allP.add(k));

  return Array.from(allP)
    .sort()
    .map((p) => {
      const ing = ingMap.get(p) ?? 0;
      const egr = egrMap.get(p);
      const costosOp = egr?.operativos ?? 0;
      const costosCom = egr?.comerciales ?? 0;
      const costosFin = egr?.financieros ?? 0;
      const gan = egr?.ganancias ?? 0;

      const margenBruto = ing - costosOp;
      const resultadoAntesGanancias = margenBruto - costosCom - costosFin;
      const resultadoNeto = resultadoAntesGanancias - gan;
      const margenPct = ing > 0 ? (resultadoNeto / ing) * 100 : 0;

      return {
        periodo: p,
        ingresos: ing,
        costosOperativos: costosOp,
        margenBruto,
        costosComercialesAdmin: costosCom,
        costosFinancieros: costosFin,
        resultadoAntesGanancias,
        ganancias: gan,
        resultadoNeto,
        margenPct,
      };
    });
}

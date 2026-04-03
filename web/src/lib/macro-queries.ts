/**
 * Queries para el módulo de Indicadores Macroeconómicos.
 * Lee datos de la tabla indicador_macro en Supabase.
 */
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MacroRow {
  tipo: string;
  fecha: string; // YYYY-MM-DD
  valor: number;
  variacion_mensual: number | null;
  fuente_api: string | null;
  updated_at: string;
}

export interface MacroKpis {
  // IPC
  inflacionMensual: number | null;
  inflacionInteranual: number | null;
  inflacionDelta: number | null; // vs mes anterior
  inflacionFecha: string | null;
  // Dólar oficial
  dolarOficial: number | null;
  dolarOficialDelta: number | null;
  dolarOficialFecha: string | null;
  // Dólar blue
  dolarBlue: number | null;
  dolarBlueDelta: number | null;
  dolarBlueFecha: string | null;
  // Tasa
  tasa: number | null;
  tasaDelta: number | null;
  tasaFecha: string | null;
}

export interface MacroTableRow {
  periodo: string; // YYYY-MM
  ipcMensual: number | null;
  ipcAcumulado: number | null;
  dolarOficial: number | null;
  dolarBlue: number | null;
  brecha: number | null;
  tasa: number | null;
}

export interface InflacionAnual {
  anio: string;
  acumulada: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE = 1000;

async function fetchAllMacro(tipo: string): Promise<MacroRow[]> {
  const all: MacroRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("indicador_macro")
      .select("tipo, fecha, valor, variacion_mensual, fuente_api, updated_at")
      .eq("tipo", tipo)
      .order("fecha", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as MacroRow[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/** Last N rows by date for a tipo */
async function fetchLastN(tipo: string, n: number): Promise<MacroRow[]> {
  const { data } = await supabase
    .from("indicador_macro")
    .select("tipo, fecha, valor, variacion_mensual, fuente_api, updated_at")
    .eq("tipo", tipo)
    .order("fecha", { ascending: false })
    .limit(n);
  return (data as MacroRow[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export async function fetchMacroKpis(): Promise<MacroKpis> {
  // Fetch last 13 IPC rows (for interanual), last 2 dólar rows, last 2 tasa
  const [ipcRows, dolarOfRows, dolarBlueRows, tasaRows] = await Promise.all([
    fetchLastN("ipc", 13),
    fetchLastN("dolar_oficial", 2),
    fetchLastN("dolar_blue", 2),
    fetchLastN("tasa_bcra", 2),
  ]);

  // IPC
  let inflacionMensual: number | null = null;
  let inflacionInteranual: number | null = null;
  let inflacionDelta: number | null = null;
  let inflacionFecha: string | null = null;

  if (ipcRows.length >= 1) {
    const latest = ipcRows[0]; // most recent (desc order)
    inflacionMensual = latest.variacion_mensual;
    inflacionFecha = latest.fecha;

    if (ipcRows.length >= 2 && latest.variacion_mensual != null && ipcRows[1].variacion_mensual != null) {
      inflacionDelta = latest.variacion_mensual - ipcRows[1].variacion_mensual;
    }

    // Interanual: compound last 12 monthly variations
    if (ipcRows.length >= 13) {
      const last12 = ipcRows.slice(0, 12); // most recent 12
      let compounded = 1;
      for (const r of last12) {
        if (r.variacion_mensual != null) {
          compounded *= 1 + r.variacion_mensual / 100;
        }
      }
      inflacionInteranual = (compounded - 1) * 100;
    }
  }

  // Dólar oficial
  const dolarOficial = dolarOfRows.length >= 1 ? dolarOfRows[0].valor : null;
  const dolarOficialDelta =
    dolarOfRows.length >= 2 ? dolarOfRows[0].valor - dolarOfRows[1].valor : null;
  const dolarOficialFecha = dolarOfRows.length >= 1 ? dolarOfRows[0].fecha : null;

  // Dólar blue
  const dolarBlue = dolarBlueRows.length >= 1 ? dolarBlueRows[0].valor : null;
  const dolarBlueDelta =
    dolarBlueRows.length >= 2 ? dolarBlueRows[0].valor - dolarBlueRows[1].valor : null;
  const dolarBlueFecha = dolarBlueRows.length >= 1 ? dolarBlueRows[0].fecha : null;

  // Tasa
  const tasa = tasaRows.length >= 1 ? tasaRows[0].valor : null;
  const tasaDelta = tasaRows.length >= 2 ? tasaRows[0].valor - tasaRows[1].valor : null;
  const tasaFecha = tasaRows.length >= 1 ? tasaRows[0].fecha : null;

  return {
    inflacionMensual,
    inflacionInteranual,
    inflacionDelta,
    inflacionFecha,
    dolarOficial,
    dolarOficialDelta,
    dolarOficialFecha,
    dolarBlue,
    dolarBlueDelta,
    dolarBlueFecha,
    tasa,
    tasaDelta,
    tasaFecha,
  };
}

// ---------------------------------------------------------------------------
// Chart data: IPC mensual últimos 24 meses
// ---------------------------------------------------------------------------

export async function fetchIpcMensual24(): Promise<{ periodo: string; valor: number }[]> {
  const rows = await fetchLastN("ipc", 24);
  return rows
    .filter((r) => r.variacion_mensual != null)
    .reverse()
    .map((r) => ({
      periodo: r.fecha.slice(0, 7),
      valor: r.variacion_mensual!,
    }));
}

// ---------------------------------------------------------------------------
// Chart data: Dólar oficial vs blue últimos 12 meses (monthly last value)
// ---------------------------------------------------------------------------

export async function fetchDolarEvolucion(): Promise<
  { periodo: string; oficial: number | null; blue: number | null }[]
> {
  const [oficialAll, blueAll] = await Promise.all([
    fetchAllMacro("dolar_oficial"),
    fetchAllMacro("dolar_blue"),
  ]);

  // Group by YYYY-MM, take last value in each month
  const groupByMonth = (rows: MacroRow[]) => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const m = r.fecha.slice(0, 7);
      map.set(m, r.valor); // last one wins (sorted asc)
    }
    return map;
  };

  const oficialMap = groupByMonth(oficialAll);
  const blueMap = groupByMonth(blueAll);

  // Merge all periods
  const allPeriods = new Set([...Array.from(oficialMap.keys()), ...Array.from(blueMap.keys())]);
  const sorted = Array.from(allPeriods).sort();
  const last12 = sorted.slice(-12);

  return last12.map((p) => ({
    periodo: p,
    oficial: oficialMap.get(p) ?? null,
    blue: blueMap.get(p) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Chart data: Tasa vs inflación
// ---------------------------------------------------------------------------

export async function fetchTasaVsInflacion(): Promise<
  { periodo: string; tasa: number | null; inflacion: number | null }[]
> {
  const [ipcAll, tasaAll] = await Promise.all([
    fetchAllMacro("ipc"),
    fetchAllMacro("tasa_bcra"),
  ]);

  // IPC: by month, variacion_mensual
  const ipcMap = new Map<string, number>();
  for (const r of ipcAll) {
    if (r.variacion_mensual != null) ipcMap.set(r.fecha.slice(0, 7), r.variacion_mensual);
  }

  // Tasa: by month, last value
  const tasaMap = new Map<string, number>();
  for (const r of tasaAll) {
    tasaMap.set(r.fecha.slice(0, 7), r.valor);
  }

  const allPeriods = new Set([...Array.from(ipcMap.keys()), ...Array.from(tasaMap.keys())]);
  const sorted = Array.from(allPeriods).sort();
  const last24 = sorted.slice(-24);

  return last24.map((p) => ({
    periodo: p,
    tasa: tasaMap.get(p) ?? null,
    inflacion: ipcMap.get(p) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Chart data: Inflación acumulada por año
// ---------------------------------------------------------------------------

export async function fetchInflacionAnual(): Promise<InflacionAnual[]> {
  const ipcAll = await fetchAllMacro("ipc");
  // Group by year, compound monthly variations
  const yearMap = new Map<string, number>();
  for (const r of ipcAll) {
    if (r.variacion_mensual == null) continue;
    const anio = r.fecha.slice(0, 4);
    const prev = yearMap.get(anio) ?? 1;
    yearMap.set(anio, prev * (1 + r.variacion_mensual / 100));
  }
  return Array.from(yearMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([anio, compounded]) => ({ anio, acumulada: (compounded - 1) * 100 }));
}

// ---------------------------------------------------------------------------
// RECPAM: inflación mensual real por período
// ---------------------------------------------------------------------------

/**
 * Retorna un mapa de YYYY-MM → variacion_mensual como decimal (ej: 0.03 para 3%).
 * Se usa para calcular el RECPAM estimado con inflación real en lugar del ratio fijo.
 */
export async function fetchIpcMensualMap(): Promise<Map<string, number>> {
  const rows = await fetchAllMacro("ipc");
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.variacion_mensual != null) {
      map.set(r.fecha.slice(0, 7), r.variacion_mensual / 100);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Table: últimos 24 meses
// ---------------------------------------------------------------------------

export async function fetchMacroTable(): Promise<MacroTableRow[]> {
  const [ipcAll, oficialAll, blueAll, tasaAll] = await Promise.all([
    fetchAllMacro("ipc"),
    fetchAllMacro("dolar_oficial"),
    fetchAllMacro("dolar_blue"),
    fetchAllMacro("tasa_bcra"),
  ]);

  // IPC by month
  const ipcMonthly = new Map<string, number>();
  for (const r of ipcAll) {
    if (r.variacion_mensual != null) ipcMonthly.set(r.fecha.slice(0, 7), r.variacion_mensual);
  }

  // IPC cumulative by month (use valor = index)
  const ipcIndex = new Map<string, number>();
  for (const r of ipcAll) {
    ipcIndex.set(r.fecha.slice(0, 7), r.valor);
  }

  // Dólar by month (last value)
  const lastByMonth = (rows: MacroRow[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.fecha.slice(0, 7), r.valor);
    return m;
  };

  const oficialMap = lastByMonth(oficialAll);
  const blueMap = lastByMonth(blueAll);
  const tasaMap = lastByMonth(tasaAll);

  // All periods
  const allPeriods = new Set([
    ...Array.from(ipcMonthly.keys()),
    ...Array.from(oficialMap.keys()),
    ...Array.from(blueMap.keys()),
    ...Array.from(tasaMap.keys()),
  ]);
  const sorted = Array.from(allPeriods).sort();
  const last24 = sorted.slice(-24);

  // For IPC acumulado: year-to-date compound
  const yearAccum = new Map<string, number>(); // "YYYY" → running product

  return last24.map((p) => {
    const ipc = ipcMonthly.get(p) ?? null;
    const oficial = oficialMap.get(p) ?? null;
    const blue = blueMap.get(p) ?? null;
    const t = tasaMap.get(p) ?? null;
    const brecha =
      oficial && blue && oficial > 0 ? ((blue - oficial) / oficial) * 100 : null;

    // IPC acumulado YTD
    const year = p.slice(0, 4);
    if (ipc != null) {
      const prev = yearAccum.get(year) ?? 1;
      yearAccum.set(year, prev * (1 + ipc / 100));
    }
    const acum = yearAccum.get(year);
    const ipcAcumulado = acum != null ? (acum - 1) * 100 : null;

    return {
      periodo: p,
      ipcMensual: ipc,
      ipcAcumulado,
      dolarOficial: oficial,
      dolarBlue: blue,
      brecha,
      tasa: t,
    };
  });
}

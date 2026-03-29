import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// ---------------------------------------------------------------------------
// Helper: fetch with timeout
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url: string, ms = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// Batch upsert helper
// ---------------------------------------------------------------------------
async function batchUpsert(
  rows: Record<string, unknown>[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("indicador_macro")
      .upsert(batch, { onConflict: "tipo,fecha", ignoreDuplicates: false });
    if (error) return { ok: false, count: upserted, error: error.message };
    upserted += batch.length;
  }
  return { ok: true, count: upserted };
}

// ---------------------------------------------------------------------------
// IPC / Inflación mensual — argentinadatos.com
// Response: [{fecha: "YYYY-MM-DD", valor: 2.9}]
// valor is already a percentage (2.9 = 2.9%)
// ---------------------------------------------------------------------------
async function syncIpc(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      "https://api.argentinadatos.com/v1/finanzas/indices/inflacion",
    );
    if (!res.ok) return { ok: false, count: 0, error: `HTTP ${res.status}` };
    const allData: { fecha: string; valor: number }[] = await res.json();

    // Only import from 2020 onwards — older data (1943+) causes overflows
    // in the cumulative index column and is not useful for the business.
    const data = allData.filter((e) => e.fecha >= "2020-01-01");

    // Delete existing IPC rows and rebuild from API data
    await supabase.from("indicador_macro").delete().eq("tipo", "ipc");

    // Build cumulative IPC index (INDEC base dic-2016 = 100).
    // We use a base that produces values matching the INDEC IPC series.
    // IPC dic-2019 ≈ 283.44 (INDEC), so we start compounding from there.
    let ipcIndex = 283.44;
    const rows = data.map((entry) => {
      ipcIndex = ipcIndex * (1 + entry.valor / 100);
      const periodo = entry.fecha.slice(0, 7);
      return {
        tipo: "ipc",
        fecha: `${periodo}-01`,
        valor: Math.round(ipcIndex * 10) / 10, // 1 decimal
        variacion_mensual: entry.valor,
        fuente_api: "argentinadatos.com",
      };
    });

    return batchUpsert(rows);
  } catch (e: unknown) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Dólar Oficial — argentinadatos.com (histórico) + dolarapi.com (hoy)
// ArgentinaDatos: [{casa, compra, venta, fecha}]
// DolarAPI: {compra, venta, ...}
// ---------------------------------------------------------------------------
async function syncDolarOficial(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    // Historical data from ArgentinaDatos
    const [histRes, todayRes] = await Promise.all([
      fetchWithTimeout("https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial"),
      fetchWithTimeout("https://dolarapi.com/v1/dolares/oficial"),
    ]);

    const rows: Record<string, unknown>[] = [];

    if (histRes.ok) {
      const histData: { casa: string; compra: number; venta: number; fecha: string }[] =
        await histRes.json();
      for (const entry of histData) {
        rows.push({
          tipo: "dolar_oficial",
          fecha: entry.fecha,
          valor: entry.venta,
          fuente_api: "argentinadatos.com",
        });
      }
    }

    // Today's quote from DolarAPI
    if (todayRes.ok) {
      const todayData = await todayRes.json();
      const today = new Date().toISOString().slice(0, 10);
      rows.push({
        tipo: "dolar_oficial",
        fecha: today,
        valor: Number(todayData.venta),
        fuente_api: "dolarapi.com",
      });
    }

    if (rows.length === 0) {
      return { ok: false, count: 0, error: "No data from either source" };
    }

    return batchUpsert(rows);
  } catch (e: unknown) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Dólar Blue — argentinadatos.com (histórico) + dolarapi.com (hoy)
// ---------------------------------------------------------------------------
async function syncDolarBlue(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const [histRes, todayRes] = await Promise.all([
      fetchWithTimeout("https://api.argentinadatos.com/v1/cotizaciones/dolares/blue"),
      fetchWithTimeout("https://dolarapi.com/v1/dolares/blue"),
    ]);

    const rows: Record<string, unknown>[] = [];

    if (histRes.ok) {
      const histData: { casa: string; compra: number; venta: number; fecha: string }[] =
        await histRes.json();
      for (const entry of histData) {
        rows.push({
          tipo: "dolar_blue",
          fecha: entry.fecha,
          valor: entry.venta,
          fuente_api: "argentinadatos.com",
        });
      }
    }

    // Today's quote from DolarAPI
    if (todayRes.ok) {
      const todayData = await todayRes.json();
      const today = new Date().toISOString().slice(0, 10);
      rows.push({
        tipo: "dolar_blue",
        fecha: today,
        valor: Number(todayData.venta),
        fuente_api: "dolarapi.com",
      });
    }

    if (rows.length === 0) {
      return { ok: false, count: 0, error: "No data from either source" };
    }

    return batchUpsert(rows);
  } catch (e: unknown) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Tasa de interés (depósitos 30 días) — argentinadatos.com
// Response: [{fecha: "YYYY-MM-DD", valor: 25.1}]
// valor is already TNA % (25.1 = 25.1%)
// ---------------------------------------------------------------------------
async function syncTasa(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      "https://api.argentinadatos.com/v1/finanzas/tasas/depositos30Dias",
    );
    if (!res.ok) return { ok: false, count: 0, error: `HTTP ${res.status}` };
    const data: { fecha: string; valor: number }[] = await res.json();

    const rows = data.map((entry) => ({
      tipo: "tasa_bcra",
      fecha: entry.fecha,
      valor: entry.valor,
      fuente_api: "argentinadatos.com",
    }));

    return batchUpsert(rows);
  } catch (e: unknown) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// POST /api/macro/sync — run all syncs
// ---------------------------------------------------------------------------
export async function POST() {
  const [ipc, dolarOficial, dolarBlue, tasa] = await Promise.allSettled([
    syncIpc(),
    syncDolarOficial(),
    syncDolarBlue(),
    syncTasa(),
  ]);

  const result = {
    ipc: ipc.status === "fulfilled" ? ipc.value : { ok: false, count: 0, error: "rejected" },
    dolar_oficial:
      dolarOficial.status === "fulfilled"
        ? dolarOficial.value
        : { ok: false, count: 0, error: "rejected" },
    dolar_blue:
      dolarBlue.status === "fulfilled"
        ? dolarBlue.value
        : { ok: false, count: 0, error: "rejected" },
    tasa:
      tasa.status === "fulfilled" ? tasa.value : { ok: false, count: 0, error: "rejected" },
  };

  const allOk = Object.values(result).every((r) => r.ok);
  return NextResponse.json(result, { status: allOk ? 200 : 207 });
}

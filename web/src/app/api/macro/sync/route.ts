import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client (same creds, but only runs on server)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// ---------------------------------------------------------------------------
// Helper: fetch with timeout + optional headers
// ---------------------------------------------------------------------------
async function fetchWithTimeout(
  url: string,
  opts?: { headers?: Record<string, string>; ms?: number },
): Promise<Response> {
  const ms = opts?.ms ?? 10000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: opts?.headers,
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function bcraHeaders(): Record<string, string> {
  const token = process.env.ESTADISTICAS_BCRA_TOKEN;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// IPC / Inflación mensual — estadisticasbcra.com
// ---------------------------------------------------------------------------
async function syncIpc(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const res = await fetchWithTimeout("https://api.estadisticasbcra.com/inflacion_mensual_oficial", { headers: bcraHeaders() });
    if (!res.ok) return { ok: false, count: 0, error: `HTTP ${res.status}` };
    const data: { d: string; v: number }[] = await res.json();

    // Build rows: each entry is a month with % variation
    // We also need cumulative IPC index. Base = 100 at start, compound monthly.
    let ipcIndex = 100;
    const rows: {
      tipo: string;
      fecha: string;
      valor: number;
      variacion_mensual: number;
      fuente_api: string;
    }[] = [];

    for (const entry of data) {
      ipcIndex = ipcIndex * (1 + entry.v / 100);
      rows.push({
        tipo: "ipc",
        fecha: entry.d, // YYYY-MM-DD
        valor: ipcIndex,
        variacion_mensual: entry.v,
        fuente_api: "estadisticasbcra.com",
      });
    }

    // Upsert in batches of 500
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
  } catch (e: unknown) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Dólar Oficial — dolarapi.com
// ---------------------------------------------------------------------------
async function syncDolarOficial(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const res = await fetchWithTimeout("https://dolarapi.com/v1/dolares/oficial");
    if (!res.ok) return { ok: false, count: 0, error: `HTTP ${res.status}` };
    const data = await res.json();

    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("indicador_macro").upsert(
      {
        tipo: "dolar_oficial",
        fecha: today,
        valor: Number(data.venta),
        fuente_api: "dolarapi.com",
      },
      { onConflict: "tipo,fecha", ignoreDuplicates: false },
    );
    if (error) return { ok: false, count: 0, error: error.message };
    return { ok: true, count: 1 };
  } catch (e: unknown) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Dólar Blue — dolarapi.com
// ---------------------------------------------------------------------------
async function syncDolarBlue(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const res = await fetchWithTimeout("https://dolarapi.com/v1/dolares/blue");
    if (!res.ok) return { ok: false, count: 0, error: `HTTP ${res.status}` };
    const data = await res.json();

    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase.from("indicador_macro").upsert(
      {
        tipo: "dolar_blue",
        fecha: today,
        valor: Number(data.venta),
        fuente_api: "dolarapi.com",
      },
      { onConflict: "tipo,fecha", ignoreDuplicates: false },
    );
    if (error) return { ok: false, count: 0, error: error.message };
    return { ok: true, count: 1 };
  } catch (e: unknown) {
    return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Tasa de interés (depósitos 30 días) — estadisticasbcra.com
// ---------------------------------------------------------------------------
async function syncTasa(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const res = await fetchWithTimeout("https://api.estadisticasbcra.com/tasa_depositos_30_dias", { headers: bcraHeaders() });
    if (!res.ok) return { ok: false, count: 0, error: `HTTP ${res.status}` };
    const data: { d: string; v: number }[] = await res.json();

    const rows = data.map((entry) => ({
      tipo: "tasa_bcra",
      fecha: entry.d,
      valor: entry.v,
      fuente_api: "estadisticasbcra.com",
    }));

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

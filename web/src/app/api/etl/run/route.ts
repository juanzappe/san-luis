import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 600;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const VALID_LOADERS = new Set([
  "productos",
  "arca_ingresos",
  "arca_egresos",
  "sueldos",
  "banco_provincia",
  "movimiento_santander",
  "mercado_pago",
  "movimientos_caja",
  "mostrador",
  "inversiones",
  "impuestos_nacionales",
  "impuestos_municipales",
  "eecc",
  "servicios",
  "segmentacion",
  "ipc",
]);

const LOADER_TIMEOUT_MS = 600_000; // 10 min por loader

function execPromise(
  args: string[],
  options: { cwd: string; timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("python", args, options, (err, stdout, stderr) => {
      if (err) {
        reject(
          Object.assign(err, {
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
          }),
        );
      } else {
        resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
      }
    });
  });
}

function parseRegistros(output: string, loader: string): number | null {
  const re = new RegExp(`✓\\s*${loader}:\\s*(\\d+)\\s*registros`);
  const match = output.match(re);
  return match ? parseInt(match[1], 10) : null;
}

interface LoaderResult {
  loader: string;
  ok: boolean;
  registros: number | null;
  output: string;
  error?: string;
}

async function runSingleLoader(
  loader: string,
  etlDir: string,
  logIds: Map<string, number[]>,
): Promise<LoaderResult> {
  // Marcar logs asociados como "procesando"
  const ids = logIds.get(loader) ?? [];
  if (ids.length > 0) {
    await supabase
      .from("import_log")
      .update({ estado: "procesando" })
      .in("id", ids);
  }

  try {
    const { stdout, stderr } = await execPromise(
      ["main.py", loader],
      { cwd: etlDir, timeout: LOADER_TIMEOUT_MS },
    );
    const registros = parseRegistros(stdout, loader);

    if (ids.length > 0) {
      await supabase
        .from("import_log")
        .update({ estado: "procesado", registros_procesados: registros })
        .in("id", ids);
    }

    return {
      loader,
      ok: true,
      registros,
      output: (stdout + "\n" + stderr).slice(0, 2000),
    };
  } catch (execErr) {
    const e = execErr as Error & { stdout?: string; stderr?: string };
    const out = (e.stdout ?? "") + "\n" + (e.stderr ?? e.message);

    if (ids.length > 0) {
      await supabase
        .from("import_log")
        .update({
          estado: "error",
          error_mensaje: (e.stderr ?? e.message).slice(0, 1000),
        })
        .in("id", ids);
    }

    return {
      loader,
      ok: false,
      registros: null,
      output: out.slice(0, 2000),
      error: `Error ejecutando ${loader}`,
    };
  }
}

async function refreshMvs(): Promise<{ ok: boolean; elapsed_ms: number; error?: string }> {
  const t0 = Date.now();
  const { error } = await supabase.rpc("refresh_aggregate_mvs");
  const elapsed_ms = Date.now() - t0;
  if (error) return { ok: false, elapsed_ms, error: error.message };
  return { ok: true, elapsed_ms };
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "ETL solo disponible en desarrollo local" },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();

    // Backward-compatible: accept either `loader: string` or `loaders: string[]`.
    let loaders: string[] = [];
    if (typeof body.loader === "string") loaders = [body.loader];
    if (Array.isArray(body.loaders)) loaders = body.loaders;

    // Legacy: old callers pass a single logId tied to a single loader.
    // New callers can pass logIdsByLoader: { [loader]: number[] }.
    const logIds = new Map<string, number[]>();
    if (typeof body.logId === "number" && loaders.length === 1) {
      logIds.set(loaders[0], [body.logId]);
    }
    if (body.logIdsByLoader && typeof body.logIdsByLoader === "object") {
      for (const [k, v] of Object.entries(body.logIdsByLoader)) {
        if (Array.isArray(v)) logIds.set(k, v as number[]);
      }
    }

    // Validar
    if (loaders.length === 0) {
      return NextResponse.json({ error: "Se requiere 'loader' o 'loaders'" }, { status: 400 });
    }
    const invalid = loaders.filter((l) => !VALID_LOADERS.has(l));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Loader(s) inválido(s): ${invalid.join(", ")}` },
        { status: 400 },
      );
    }

    const etlDir = path.resolve(process.cwd(), "..", "etl");

    // Ejecutar loaders secuencialmente (algunos dependen de FKs de otros).
    const results: LoaderResult[] = [];
    for (const loader of loaders) {
      const r = await runSingleLoader(loader, etlDir, logIds);
      results.push(r);
    }

    // Refrescar MVs al final si al menos un loader tuvo éxito.
    const anyOk = results.some((r) => r.ok);
    const refresh = anyOk ? await refreshMvs() : null;

    const allOk = results.every((r) => r.ok);
    return NextResponse.json({
      ok: allOk,
      results,
      refresh,
    }, { status: allOk ? 200 : 207 /* multi-status */ });
  } catch (err) {
    console.error("[etl/run] Unhandled error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

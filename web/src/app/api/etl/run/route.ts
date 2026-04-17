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

// Timeout del proceso Python: 10 min. Multi-loader corre en UNA sola invocación
// así que este techo cubre todo el batch.
const BATCH_TIMEOUT_MS = 600_000;

function execPromise(
  args: string[],
  options: { cwd: string; timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // PYTHONIOENCODING=utf-8 evita que Python escape Unicode a \uXXXX cuando
    // stdout no es una TTY (default en Windows, rompe el parseo de ✓/✗).
    const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
    execFile("python", args, { ...options, env }, (err, stdout, stderr) => {
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

interface LoaderResult {
  loader: string;
  ok: boolean;
  registros: number | null;
  output: string;
  error?: string;
}

/**
 * Parsea la salida combinada de main.py (una corrida con múltiples loaders)
 * y extrae el resultado de cada loader por nombre.
 *
 * Formato esperado de main.py (ver etl/main.py):
 *   ✓ LOADER: N registros en Ts
 *   ✗ LOADER: error_msg (Ts)
 */
function parseLoaderResults(
  output: string,
  loaders: string[],
): LoaderResult[] {
  return loaders.map((loader) => {
    // Acepta el glifo Unicode real (✓/✗) o el escape literal que Python emite
    // a veces en Windows sin PYTHONIOENCODING=utf-8.
    const okRe = new RegExp(`(?:✓|\\\\u2713)\\s*${loader}:\\s*(\\d+)\\s*registros`);
    const errRe = new RegExp(`(?:✗|\\\\u2717)\\s*${loader}:`);
    const okMatch = output.match(okRe);
    if (okMatch) {
      return {
        loader,
        ok: true,
        registros: parseInt(okMatch[1], 10),
        output: output.slice(-2000),
      };
    }
    if (errRe.test(output)) {
      return {
        loader,
        ok: false,
        registros: null,
        output: output.slice(-2000),
        error: `Error ejecutando ${loader}`,
      };
    }
    // Loader no apareció en la salida (p.ej. main.py nunca lo invocó).
    return {
      loader,
      ok: false,
      registros: null,
      output: output.slice(-2000),
      error: `Loader ${loader} no ejecutado`,
    };
  });
}

/**
 * `main.py` ya dispara `refresh_aggregate_mvs()` al final de cada corrida
 * exitosa. Acá parseamos el log para reportar si pasó y cuánto tardó.
 *
 * (No llamamos a refresh desde Node porque Supabase REST corta a los ~8s
 * por statement_timeout y el refresh completo toma ~22s.)
 */
function parseRefreshFromOutput(output: string): { ok: boolean; elapsed_ms: number } | null {
  const m = output.match(/refresh_aggregate_mvs:\s*([\d.]+)s/);
  if (!m) return null;
  return { ok: true, elapsed_ms: Math.round(parseFloat(m[1]) * 1000) };
}

export async function POST(request: NextRequest) {
  // Bloquear solo cuando el código corre en un deploy remoto (Vercel).
  // Con `npm start` local (NODE_ENV=production pero VERCEL undefined) el ETL
  // debe funcionar: los loaders viven en el filesystem del usuario.
  if (process.env.VERCEL) {
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

    // Marcar todos los logs como "procesando"
    const allIds = Array.from(logIds.values()).flat();
    if (allIds.length > 0) {
      await supabase
        .from("import_log")
        .update({ estado: "procesando" })
        .in("id", allIds);
    }

    const etlDir = path.resolve(process.cwd(), "..", "etl");

    // Una sola invocación de main.py con todos los loaders. main.py respeta
    // el orden recibido y corre refresh_aggregate_mvs() UNA vez al final.
    let stdout = "";
    let stderr = "";
    let execError: Error | null = null;
    try {
      const result = await execPromise(
        ["main.py", ...loaders],
        { cwd: etlDir, timeout: BATCH_TIMEOUT_MS },
      );
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (e) {
      const err = e as Error & { stdout?: string; stderr?: string };
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? err.message;
      execError = err;
    }

    const combined = stdout + "\n" + stderr;
    const results = parseLoaderResults(combined, loaders);

    // Actualizar logs según el resultado parseado
    for (const result of results) {
      const ids = logIds.get(result.loader) ?? [];
      if (ids.length === 0) continue;
      if (result.ok) {
        await supabase
          .from("import_log")
          .update({
            estado: "procesado",
            registros_procesados: result.registros,
          })
          .in("id", ids);
      } else {
        await supabase
          .from("import_log")
          .update({
            estado: "error",
            error_mensaje: (result.error ?? "Loader falló").slice(0, 1000),
          })
          .in("id", ids);
      }
    }

    const refresh = parseRefreshFromOutput(combined);
    const allOk = results.every((r) => r.ok) && !execError;

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

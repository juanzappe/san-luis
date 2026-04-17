import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// Whitelist of valid loader names
const VALID_LOADERS = new Set([
  "productos",
  "arca_ingresos",
  "arca_egresos",
  "sueldos",
  "banco_provincia",
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
  // Match: "✓ {loader}: {N} registros"
  const re = new RegExp(`✓\\s*${loader}:\\s*(\\d+)\\s*registros`);
  const match = output.match(re);
  return match ? parseInt(match[1], 10) : null;
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
    const loader = body.loader as string;
    const logId = body.logId as number | undefined;

    if (!loader || !VALID_LOADERS.has(loader)) {
      return NextResponse.json(
        { error: `Loader inválido: ${loader}. Válidos: ${Array.from(VALID_LOADERS).join(", ")}` },
        { status: 400 },
      );
    }

    // Update log status to "procesando"
    if (logId) {
      await supabase
        .from("import_log")
        .update({ estado: "procesando" })
        .eq("id", logId);
    }

    const etlDir = path.resolve(process.cwd(), "..", "etl");

    let stdout: string;
    let stderr: string;
    try {
      const result = await execPromise(["main.py", loader], { cwd: etlDir, timeout: 120_000 });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (execErr) {
      const e = execErr as Error & { stdout?: string; stderr?: string };
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? e.message;

      // Update log with error
      if (logId) {
        await supabase
          .from("import_log")
          .update({
            estado: "error",
            error_mensaje: stderr.slice(0, 1000),
          })
          .eq("id", logId);
      }

      return NextResponse.json({
        ok: false,
        error: `Error ejecutando ${loader}`,
        output: (stdout + "\n" + stderr).slice(0, 2000),
      }, { status: 500 });
    }

    const registros = parseRegistros(stdout, loader);

    // Update log with success
    if (logId) {
      await supabase
        .from("import_log")
        .update({
          estado: "procesado",
          registros_procesados: registros,
        })
        .eq("id", logId);
    }

    return NextResponse.json({
      ok: true,
      loader,
      registros,
      output: (stdout + "\n" + stderr).slice(0, 2000),
    });
  } catch (err) {
    console.error("[etl/run] Unhandled error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

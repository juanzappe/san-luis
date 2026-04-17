import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls", ".txt", ".zip", ".pdf"]);

// Whitelist: fuente → data_raw subfolder
const FOLDER_MAP: Record<string, string> = {
  arca_ingresos: "ARCA_INGRESOS",
  arca_egresos: "ARCA_EGRESOS",
  mostrador: "MOSTRADOR",
  sueldos: "SUELDOS",
  banco_provincia: "MOVIMIENTOS BANCARIOS/BANCO PROVINCIA",
  movimiento_santander: "MOVIMIENTOS BANCARIOS/BANCO SANTANDER",
  mercado_pago: "MOVIMIENTOS BANCARIOS/MERCADO PAGO",
  movimientos_caja: "MOVIMIENTOS DE CAJA",
  inversiones: "INVERSIONES",
  impuestos_nacionales: "IMPUESTOS NACIONALES",
  impuestos_municipales: "IMPUESTOS MUNICIPALES",
  eecc: "EECC",
  servicios: "SERVICIOS",
  segmentacion: "SEGMENTACION",
  productos: "PRODUCTOS",
};

export async function POST(request: NextRequest) {
  // Bloquear solo en deploy remoto (Vercel). `npm start` local debe funcionar.
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: "Importación solo disponible en desarrollo local" },
      { status: 403 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const fuente = formData.get("fuente") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No se recibió archivo" }, { status: 400 });
    }
    if (!fuente || !FOLDER_MAP[fuente]) {
      return NextResponse.json(
        { error: `Fuente inválida: ${fuente}. Válidas: ${Object.keys(FOLDER_MAP).join(", ")}` },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Archivo demasiado grande (máximo 100 MB)" }, { status: 413 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: `Tipo de archivo no permitido: ${ext}. Permitidos: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}` },
        { status: 400 },
      );
    }

    // Resolve target directory
    const dataRawDir = path.resolve(process.cwd(), "..", "data_raw", FOLDER_MAP[fuente]);
    await mkdir(dataRawDir, { recursive: true });

    // Write file — use basename to prevent path traversal attacks
    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(dataRawDir, path.basename(file.name));
    await writeFile(filePath, buffer);

    // Log to import_log
    const { data: logRow, error: logError } = await supabase
      .from("import_log")
      .insert({
        archivo: file.name,
        fuente,
        tamano_bytes: file.size,
        estado: "guardado",
      })
      .select("id")
      .single();

    if (logError) {
      console.error("Error logging import:", logError);
    }

    return NextResponse.json({
      ok: true,
      archivo: file.name,
      fuente,
      path: filePath,
      logId: logRow?.id ?? null,
    });
  } catch (err) {
    console.error("[upload] Unhandled error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

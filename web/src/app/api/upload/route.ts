import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// Whitelist: fuente → data_raw subfolder
const FOLDER_MAP: Record<string, string> = {
  arca_ingresos: "ARCA_INGRESOS",
  arca_egresos: "ARCA_EGRESOS",
  mostrador: "MOSTRADOR",
  sueldos: "SUELDOS",
  banco_provincia: "MOVIMIENTOS BANCARIOS/BANCO PROVINCIA",
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
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
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

    // Resolve target directory
    const dataRawDir = path.resolve(process.cwd(), "..", "data_raw", FOLDER_MAP[fuente]);
    await mkdir(dataRawDir, { recursive: true });

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(dataRawDir, file.name);
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
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

"""Loader: IMPUESTOS MUNICIPALES → impuesto_obligacion.

Fuente: data_raw/IMPUESTOS MUNICIPALES/{year}/*.pdf
Parse: pymupdf extraer texto, regex para: TASA, Período, Importe, Boleta Nro, Vencimiento
Tipo mapping:
  "Seguridad e higiene" → tasa_seguridad_higiene
  "Publicidad y propaganda" → tasa_publicidad_propaganda
  "Ocupación espacio público" → tasa_ocupacion_espacio_publico
"""

import re
from pathlib import Path

try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

from utils import get_data_raw_path, parse_monto_argentino, parse_fecha_argentina, safe_str


TIPO_MAP = {
    "seguridad e higiene": "tasa_seguridad_higiene",
    "seguridad": "tasa_seguridad_higiene",
    "publicidad y propaganda": "tasa_publicidad_propaganda",
    "publicidad": "tasa_publicidad_propaganda",
    "ocupación espacio público": "tasa_ocupacion_espacio_publico",
    "ocupacion espacio publico": "tasa_ocupacion_espacio_publico",
    "ocupación": "tasa_ocupacion_espacio_publico",
}


def _classify_tipo(filename: str) -> str | None:
    """Determina el tipo de tasa desde el nombre del archivo."""
    name_lower = filename.lower()
    for key, val in TIPO_MAP.items():
        if key in name_lower:
            return val
    return None


def _extract_periodo(filename: str) -> str | None:
    """Extrae período del nombre. Ej: 'Seguridad e higiene Cuota 3 2024.pdf' → '2024-03'"""
    match = re.search(r"cuota\s+(\d+)\s+(\d{4})", filename, re.IGNORECASE)
    if match:
        cuota = match.group(1).zfill(2)
        year = match.group(2)
        return f"{year}-{cuota}"
    return None


def _parse_pdf(path: Path, logger) -> dict | None:
    """Extrae datos de una boleta municipal PDF."""
    if not HAS_PYMUPDF:
        logger.warning("  PyMuPDF no disponible, saltando PDFs")
        return None

    try:
        doc = fitz.open(str(path))
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
    except Exception as e:
        logger.warning(f"  Error leyendo PDF {path.name}: {e}")
        return None

    # Extraer importe
    importe = None
    # Buscar patrones de importe
    for pattern in [
        r"(?:total|importe)[:\s]*\$?\s*([\d.,]+)",
        r"\$\s*([\d.,]+)",
        r"(?:1er|2do|1°|2°)\s*vto[:\s]*\$?\s*([\d.,]+)",
    ]:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            importe = parse_monto_argentino(match.group(1))
            if importe:
                break

    # Extraer vencimiento
    fecha_vto = None
    vto_match = re.search(r"(?:vencimiento|1er\s*vto|1°\s*vto)[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", text, re.IGNORECASE)
    if vto_match:
        fecha_vto = parse_fecha_argentina(vto_match.group(1))

    # Extraer 2do vencimiento
    fecha_2do_vto = None
    vto2_match = re.search(r"(?:2do\s*vto|2°\s*vto)[:\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", text, re.IGNORECASE)
    if vto2_match:
        fecha_2do_vto = parse_fecha_argentina(vto2_match.group(1))

    # Extraer recargo 2do vto
    recargo = None
    recargo_match = re.search(r"2do?\s*vto[:\s]*\$?\s*([\d.,]+)", text, re.IGNORECASE)
    if recargo_match:
        recargo = parse_monto_argentino(recargo_match.group(1))

    # Extraer número de boleta
    boleta = None
    boleta_match = re.search(r"(?:boleta|nro|n°)[:\s]*(\d+)", text, re.IGNORECASE)
    if boleta_match:
        boleta = boleta_match.group(1)

    # Extraer número de tasa
    numero_tasa = None
    tasa_match = re.search(r"(?:tasa|código)[:\s]*(\d+)", text, re.IGNORECASE)
    if tasa_match:
        numero_tasa = tasa_match.group(1)

    return {
        "monto_determinado": importe,
        "fecha_vencimiento": fecha_vto,
        "fecha_2do_vto": fecha_2do_vto,
        "recargo_2do_vto": recargo,
        "numero_boleta": boleta,
        "numero_tasa": numero_tasa,
    }


def run(sb, logger) -> int:
    data_dir = get_data_raw_path() / "IMPUESTOS MUNICIPALES"
    pdf_files = sorted(data_dir.rglob("*.pdf"))
    logger.info(f"  {len(pdf_files)} archivos PDF encontrados")

    if not HAS_PYMUPDF:
        logger.warning("  PyMuPDF no instalado. Instalá con: pip install PyMuPDF")
        logger.warning("  Cargando solo metadata de archivos (sin parseo de contenido)")

    all_records = []

    for pdf_path in pdf_files:
        logger.info(f"  Procesando {pdf_path.name}")

        tipo = _classify_tipo(pdf_path.name)
        periodo = _extract_periodo(pdf_path.name)

        if not tipo:
            logger.warning(f"  No se pudo clasificar tipo para {pdf_path.name}")
            continue

        if not periodo:
            logger.warning(f"  No se pudo extraer período de {pdf_path.name}")
            continue

        record = {
            "tipo": tipo,
            "periodo": periodo,
            "estado": "pendiente",
            "fuente": "municipio",
        }

        # Intentar extraer datos del PDF
        pdf_data = _parse_pdf(pdf_path, logger)
        if pdf_data:
            record.update({k: v for k, v in pdf_data.items() if v is not None})

        all_records.append(record)

    logger.info(f"  {len(all_records)} obligaciones municipales a cargar")

    # Delete municipales + insert
    sb.table("impuesto_obligacion").delete().eq("fuente", "municipio").execute()
    count = 0
    batch_size = 500
    for i in range(0, len(all_records), batch_size):
        batch = all_records[i:i + batch_size]
        sb.table("impuesto_obligacion").insert(batch).execute()
        count += len(batch)

    return count

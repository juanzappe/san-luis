"""Loader: BANCO SANTANDER PDF → movimiento_bancario.

Fuente: data_raw/MOVIMIENTOS BANCARIOS/BANCO SANTANDER/**/*.pdf
PDF:    Resumen de cuenta mensual — texto posicionado (sin tablas reales).
        Columnas identificadas por coordenada X:
          Fecha         x ≈ 23    (DD/MM/YY)
          Comprobante   x ≈ 65
          Descripción   x ≈ 115+  (puede ocupar varias palabras / varias líneas)
          Débito        x < 430
          Crédito       430 ≤ x < 510
          Saldo         x ≥ 510
        Zona de montos: x ≥ 380 (palabras "pesos" + monto)
Fijos:  banco='santander', cuenta='019-006261/3',
        cbu='0720019920000000626136', moneda='ARS'
"""

from datetime import datetime
from pathlib import Path

import fitz  # PyMuPDF

from utils import (
    get_data_raw_path,
    parse_monto_argentino,
    safe_str,
    delete_where,
    batch_insert,
)

BANCO   = "santander"
CUENTA  = "019-006261/3"
CBU     = "0720019920000000626136"
MONEDA  = "ARS"

# Palabras en el header de la tabla (para detectar la fila de headers y saltar)
_HEADER_WORDS = {"fecha", "comprobante", "movimiento", "débito", "crédito", "saldo"}

# Páginas cuyo texto contenga estas cadenas se ignoran
_SKIP_KEYWORDS = ("Cambio de comisiones", "Legales")

# Umbrales X para clasificar columnas de montos
_X_DEBIT_MAX   = 430   # x0 < 430 → Débito
_X_CREDIT_MAX  = 510   # 430 ≤ x0 < 510 → Crédito; x0 ≥ 510 → Saldo
_X_AMOUNT_MIN  = 380   # sólo palabras con x0 ≥ 380 son montos

# Umbral X mínimo para que una palabra se considere parte de la descripción
# (Fecha ≈ 23, Comprobante ≈ 65, Descripción empieza ≈ 115)
_X_DESC_MIN    = 100
_X_FECHA_MAX   = 60    # sólo la primera columna
_X_COMP_MAX    = 110   # segunda columna (comprobante)

# Tolerancia Y para agrupar palabras en la misma fila lógica
_Y_TOLERANCE   = 3


def _parse_fecha_santander(texto: str | None) -> str | None:
    """Parsea DD/MM/YY (2 dígitos de año) → YYYY-MM-DD."""
    if not texto:
        return None
    t = str(texto).strip()
    try:
        return datetime.strptime(t, "%d/%m/%y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _looks_like_monto(word: str) -> bool:
    """True si la palabra parece un monto argentino: dígitos con puntos/comas."""
    w = word.strip()
    if not w:
        return False
    # Debe contener al menos un dígito
    if not any(c.isdigit() for c in w):
        return False
    # Acepta: 46.400,00 / 1.926.662,69 / 100,00
    stripped = w.replace(".", "").replace(",", "")
    return stripped.isdigit()


def _group_words_by_y(words: list[dict]) -> list[list[dict]]:
    """Agrupa palabras por línea Y (tolerancia _Y_TOLERANCE px)."""
    if not words:
        return []
    lines: list[list[dict]] = []
    current_line: list[dict] = [words[0]]
    current_y = words[0]["top"]

    for w in words[1:]:
        if abs(w["top"] - current_y) <= _Y_TOLERANCE:
            current_line.append(w)
        else:
            lines.append(current_line)
            current_line = [w]
            current_y = w["top"]
    lines.append(current_line)
    return lines


def _parse_santander_pdf(path: Path) -> tuple[list[dict], int]:
    """Extrae movimientos de un PDF Santander usando PyMuPDF con coordenadas."""
    records: list[dict] = []
    skipped = 0

    doc = fitz.open(str(path))

    for page_num in range(len(doc)):
        page = doc[page_num]
        page_text = page.get_text()

        # Saltar páginas que no son de movimientos
        if any(kw in page_text for kw in _SKIP_KEYWORDS):
            continue

        # Extraer palabras con coordenadas: (x0, y0, x1, y1, word, ...)
        raw_words = page.get_text("words")
        if not raw_words:
            continue

        # Convertir a lista de dicts para mayor claridad
        words = [
            {"x0": w[0], "top": w[1], "x1": w[2], "bottom": w[3], "text": w[4]}
            for w in raw_words
        ]

        # Ordenar por Y luego X
        words.sort(key=lambda w: (w["top"], w["x0"]))

        # Agrupar en líneas
        lines = _group_words_by_y(words)

        # Acumulador del movimiento en curso
        current_fecha: str | None = None
        current_comp: str | None = None
        current_desc_parts: list[str] = []
        current_debito: float | None = None
        current_credito: float | None = None
        current_saldo: float | None = None

        def flush_record():
            nonlocal current_fecha, current_comp, current_desc_parts
            nonlocal current_debito, current_credito, current_saldo

            if not current_fecha:
                return

            if current_debito is None and current_credito is None:
                nonlocal skipped
                skipped += 1
            else:
                if current_credito is not None:
                    importe = current_credito
                else:
                    importe = -(current_debito or 0)

                records.append({
                    "fecha":       current_fecha,
                    "banco":       BANCO,
                    "cuenta":      CUENTA,
                    "cbu":         CBU,
                    "moneda":      MONEDA,
                    "comprobante": safe_str(" ".join(current_comp)) if isinstance(current_comp, list) else safe_str(current_comp),
                    "concepto":    safe_str(" ".join(current_desc_parts)),
                    "debito":      current_debito,
                    "credito":     current_credito,
                    "importe":     importe,
                    "fecha_valor": None,
                    "saldo":       current_saldo,
                })

            current_fecha = None
            current_comp = None
            current_desc_parts = []
            current_debito = None
            current_credito = None
            current_saldo = None

        for line_words in lines:
            # Verificar si esta línea es la fila de headers → saltar
            line_lower = {w["text"].lower() for w in line_words}
            if line_lower & _HEADER_WORDS:
                flush_record()
                continue

            # Buscar fecha en columna izquierda
            fecha_word = next(
                (w for w in line_words if w["x0"] <= _X_FECHA_MAX and _parse_fecha_santander(w["text"])),
                None
            )

            if fecha_word:
                # Nueva transacción — guardar la anterior
                flush_record()
                current_fecha = _parse_fecha_santander(fecha_word["text"])

                # Comprobante: columna siguiente (x ≈ 65–110)
                comp_words = [
                    w for w in line_words
                    if _X_FECHA_MAX < w["x0"] <= _X_COMP_MAX
                ]
                current_comp = " ".join(w["text"] for w in comp_words) if comp_words else None

                # Descripción: palabras en zona descripción (x > _X_DESC_MIN, x < _X_AMOUNT_MIN)
                desc_words = [
                    w for w in line_words
                    if w["x0"] > _X_DESC_MIN and w["x0"] < _X_AMOUNT_MIN
                ]
                current_desc_parts = [w["text"] for w in desc_words]

            else:
                # Línea de continuación (descripción multi-línea)
                # Solo agregar si hay una transacción abierta y la línea no tiene montos
                if current_fecha:
                    desc_words = [
                        w for w in line_words
                        if w["x0"] > _X_DESC_MIN and w["x0"] < _X_AMOUNT_MIN
                    ]
                    if desc_words:
                        current_desc_parts.extend(w["text"] for w in desc_words)

            # Procesar montos en esta línea (x0 ≥ _X_AMOUNT_MIN)
            amount_words = [w for w in line_words if w["x0"] >= _X_AMOUNT_MIN]
            for w in amount_words:
                if w["text"].lower() == "pesos":
                    continue  # etiqueta, no el número
                if not _looks_like_monto(w["text"]):
                    continue

                monto = parse_monto_argentino(w["text"])
                if monto is None:
                    continue

                x = w["x0"]
                if x < _X_DEBIT_MAX:
                    current_debito = monto
                elif x < _X_CREDIT_MAX:
                    current_credito = monto
                else:
                    current_saldo = monto

        # Guardar último registro de la página
        flush_record()

    doc.close()
    return records, skipped


def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "MOVIMIENTOS BANCARIOS" / "BANCO SANTANDER"
    pdf_files = sorted(data_dir.rglob("*.pdf"))
    logger.info(f"  {len(pdf_files)} PDFs encontrados")

    all_records: list[dict] = []
    total_skipped = 0
    for pdf_path in pdf_files:
        logger.info(f"  Procesando {pdf_path.name}")
        records, skipped = _parse_santander_pdf(pdf_path)
        logger.info(f"    {len(records)} movimientos, {skipped} filas sin importe")
        all_records.extend(records)
        total_skipped += skipped

    if total_skipped:
        logger.warning(f"  {total_skipped} filas totales sin débito ni crédito (salteadas)")
    logger.info(f"  {len(all_records)} movimientos totales a cargar")

    delete_where(conn, "movimiento_bancario", "banco", BANCO)
    return batch_insert(conn, "movimiento_bancario", all_records)

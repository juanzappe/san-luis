"""Loader: BANCO SANTANDER PDF → movimiento_bancario.

Fuente: data_raw/MOVIMIENTOS BANCARIOS/BANCO SANTANDER/*.pdf
PDF:    Resumen de cuenta mensual — tablas con columnas:
        Fecha (DD/MM/YY), Comprobante, Movimiento, Débito, Crédito, Saldo en cuenta
Fijos:  banco='santander', cuenta='019-006261/3',
        cbu='0720019920000000626136', moneda='ARS'
"""

from datetime import datetime
from pathlib import Path

import pdfplumber

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

# Páginas cuyo texto contenga estas cadenas se ignoran
_SKIP_KEYWORDS = ("Cambio de comisiones", "Legales")

# Nombres de columnas del PDF tal como aparecen
_COL_FECHA     = "Fecha"
_COL_COMP      = "Comprobante"
_COL_MOVIM     = "Movimiento"
_COL_DEBITO    = "Débito"
_COL_CREDITO   = "Crédito"
_COL_SALDO     = "Saldo en cuenta"
_EXPECTED_COLS = {_COL_FECHA, _COL_MOVIM}  # mínimo para considerar tabla válida


def _parse_fecha_santander(texto: str | None) -> str | None:
    """Parsea DD/MM/YY (2 dígitos de año) → YYYY-MM-DD."""
    if not texto:
        return None
    t = str(texto).strip()
    try:
        return datetime.strptime(t, "%d/%m/%y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _parse_santander_pdf(path: Path) -> tuple[list[dict], int]:
    """Extrae movimientos de un PDF de resumen Santander. Returns (records, skipped)."""
    records = []
    skipped = 0

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""

            # Saltar páginas que no son de movimientos
            if any(kw in text for kw in _SKIP_KEYWORDS):
                continue

            for table in page.extract_tables():
                if not table or len(table) < 2:
                    continue

                # La primera fila es el header
                raw_headers = [str(h).strip() if h else "" for h in table[0]]
                col_map = {h: i for i, h in enumerate(raw_headers)}

                # Verificar que tiene las columnas mínimas esperadas
                if not _EXPECTED_COLS.issubset(col_map):
                    continue

                for row in table[1:]:
                    def cell(col: str) -> str | None:
                        idx = col_map.get(col)
                        if idx is None or idx >= len(row):
                            return None
                        return str(row[idx]).strip() if row[idx] else None

                    fecha = _parse_fecha_santander(cell(_COL_FECHA))
                    if not fecha:
                        continue  # Saldo Inicial y filas sin fecha

                    debito  = parse_monto_argentino(cell(_COL_DEBITO))
                    credito = parse_monto_argentino(cell(_COL_CREDITO))

                    # Fila sin movimiento real (ej. Saldo Inicial con saldo pero sin monto)
                    if debito is None and credito is None:
                        skipped += 1
                        continue

                    # importe con signo: crédito positivo, débito negativo
                    if credito is not None:
                        importe = credito
                    else:
                        importe = -(debito or 0)

                    records.append({
                        "fecha":       fecha,
                        "banco":       BANCO,
                        "cuenta":      CUENTA,
                        "cbu":         CBU,
                        "moneda":      MONEDA,
                        "comprobante": safe_str(cell(_COL_COMP)),
                        "concepto":    safe_str(cell(_COL_MOVIM)),
                        "debito":      debito,
                        "credito":     credito,
                        "importe":     importe,
                        "fecha_valor": None,
                        "saldo":       parse_monto_argentino(cell(_COL_SALDO)),
                    })

    return records, skipped


def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "MOVIMIENTOS BANCARIOS" / "BANCO SANTANDER"
    pdf_files = sorted(data_dir.rglob("*.pdf"))
    logger.info(f"  {len(pdf_files)} PDFs encontrados")

    all_records = []
    total_skipped = 0
    for pdf_path in pdf_files:
        logger.info(f"  Procesando {pdf_path.name}")
        records, skipped = _parse_santander_pdf(pdf_path)
        all_records.extend(records)
        total_skipped += skipped

    if total_skipped:
        logger.warning(f"  {total_skipped} filas salteadas (sin débito ni crédito)")
    logger.info(f"  {len(all_records)} movimientos a cargar")

    delete_where(conn, "movimiento_bancario", "banco", BANCO)
    return batch_insert(conn, "movimiento_bancario", all_records)

"""Loader: BANCO SANTANDER PDF/CSV → movimiento_bancario.

Fuente: data_raw/MOVIMIENTOS BANCARIOS/BANCO SANTANDER/**/*.pdf | *.csv
PDF:    Resumen de cuenta mensual — two-pass parser:
        Pass 1: Extract word coordinates via PyMuPDF to classify amounts
                into Débito / Crédito / Saldo columns by X position.
        Pass 2: Parse page text line-by-line to detect movements, descriptions,
                and match amounts to their column classification.
CSV:    Latin-1, separador ';'. Fila 6 = headers, fila 7+ = datos.
        Montos en formato argentino con paréntesis para negativos: (13.220,36) = -13220.36
Fijos:  banco='santander', cuenta='019-006261/3',
        cbu='0720019920000000626136', moneda='ARS'
"""

import re
from datetime import datetime
from pathlib import Path

import fitz  # PyMuPDF
import pandas as pd

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

# Pages whose text contains ANY of these keywords are skipped entirely
_SKIP_PAGE_KEYWORDS = (
    "Detalle impositivo",
    "Plazos Fijos",
    "Legales",
    "Cambio de comisiones",
    "Fondos Comunes",
    "Intercambio de información",
)

# X-coordinate thresholds for amount column classification
# Determined empirically from PyMuPDF word positions:
#   Débito  "pesos" x0 ≈ 357-374   number x1 ≈ 408
#   Crédito "pesos" x0 ≈ 434-441   number x1 ≈ 492
#   Saldo   "pesos" x0 ≈ 519-534   number x1 ≈ 578
_X_CREDIT_MIN = 430   # x0 >= 430 → Crédito or Saldo
_X_SALDO_MIN  = 510   # x0 >= 510 → Saldo

# Regex patterns
_RE_DATE = re.compile(r'^(\d{2}/\d{2}/\d{2})\s*(.*)')
_RE_PESOS_AMOUNT = re.compile(r'^pesos\s+([\d.,]+)')
_RE_DIGITS_ONLY = re.compile(r'^\d+$')


def _parse_fecha_santander(texto: str | None) -> str | None:
    """Parsea DD/MM/YY (2 dígitos de año) → YYYY-MM-DD."""
    if not texto:
        return None
    t = str(texto).strip()
    try:
        return datetime.strptime(t, "%d/%m/%y").strftime("%Y-%m-%d")
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# PDF parser — two-pass approach
# ---------------------------------------------------------------------------

def _build_amount_index(page) -> dict[int, list[dict]]:
    """Pass 1: Build an index of classified amounts from word coordinates.

    Returns dict mapping rounded Y position → list of
    {"column": "debito"|"credito"|"saldo", "value": float, "y0": float}
    """
    raw_words = page.get_text("words")
    if not raw_words:
        return {}

    # Sort by (y0, x0) to get reading order
    words = sorted(raw_words, key=lambda w: (w[1], w[0]))

    index: dict[int, list[dict]] = {}

    for i, w in enumerate(words):
        text = w[4].strip().lower()
        x0 = w[0]

        if text != "pesos":
            continue

        # Look at next word — should be the amount
        if i + 1 >= len(words):
            continue
        next_w = words[i + 1]
        next_text = next_w[4].strip()
        next_y0 = next_w[1]

        # The amount must be on approximately the same Y as "pesos"
        if abs(next_y0 - w[1]) > 5:
            continue

        # Check it looks like a number
        stripped = next_text.replace(".", "").replace(",", "")
        if not stripped.isdigit():
            continue

        amount = parse_monto_argentino(next_text)
        if amount is None:
            continue

        # Classify by X position of "pesos" word
        if x0 >= _X_SALDO_MIN:
            column = "saldo"
        elif x0 >= _X_CREDIT_MIN:
            column = "credito"
        else:
            column = "debito"

        y_key = round(w[1])
        if y_key not in index:
            index[y_key] = []
        index[y_key].append({"column": column, "value": amount, "y0": w[1]})

    return index


def _find_amount_column(
    amount_value: float,
    y_hint: float | None,
    index: dict[int, list[dict]],
) -> str | None:
    """Look up an amount's column classification from the coordinate index.

    Matches by amount value with Y proximity tolerance.
    """
    if not index:
        return None

    # If we have a Y hint, search nearby Y keys first
    if y_hint is not None:
        y_center = round(y_hint)
        for y_key in range(y_center - 3, y_center + 4):
            entries = index.get(y_key)
            if not entries:
                continue
            for entry in entries:
                if abs(entry["value"] - amount_value) < 0.02:
                    return entry["column"]

    # Fallback: search all entries (slower but catches edge cases)
    for entries in index.values():
        for entry in entries:
            if abs(entry["value"] - amount_value) < 0.02:
                return entry["column"]

    return None


def _is_movement_page(page_text: str) -> bool:
    """True if this page contains the movement table.

    A page is a movement page if it has the column header row
    (Movimiento + Débito) OR the section title "Movimientos en pesos".
    Skip keywords are NOT checked here — mixed pages (e.g., movements above
    "Detalle impositivo") are handled by the text parser stopping at
    "Saldo total".
    """
    return ("Movimientos en pesos" in page_text
            or ("Movimiento" in page_text and "Débito" in page_text))


def _build_y_index_from_text(page) -> dict[str, float]:
    """Build a mapping from 'pesos AMOUNT' text → approximate Y position.

    Used to provide Y hints for amount column lookup.
    """
    raw_words = page.get_text("words")
    if not raw_words:
        return {}

    words = sorted(raw_words, key=lambda w: (w[1], w[0]))
    mapping: dict[str, float] = {}

    for i, w in enumerate(words):
        if w[4].strip().lower() == "pesos" and i + 1 < len(words):
            next_w = words[i + 1]
            if abs(next_w[1] - w[1]) <= 5:
                amount_text = next_w[4].strip()
                # Use "y0:amount" as key to handle same amount at different Y
                key = f"{round(w[1])}:{amount_text}"
                mapping[key] = w[1]

    return mapping


def _parse_santander_pdf(path: Path) -> tuple[list[dict], int]:
    """Extrae movimientos de un PDF Santander usando text + coordenadas."""
    records: list[dict] = []
    skipped = 0

    doc = fitz.open(str(path))

    for page_num in range(len(doc)):
        page = doc[page_num]
        page_text = page.get_text()

        # Skip non-movement pages
        if not _is_movement_page(page_text):
            continue

        # Pass 1: Build amount column index from word coordinates
        amount_index = _build_amount_index(page)
        y_mapping = _build_y_index_from_text(page)

        # Pass 2: Parse text line by line
        lines = page_text.split("\n")

        # State for current movement being built
        current_fecha: str | None = None
        current_comp: str | None = None
        current_desc_parts: list[str] = []
        current_debito: float | None = None
        current_credito: float | None = None
        current_saldo: float | None = None
        # Track pesos amounts seen for this movement (for fallback heuristic)
        current_amounts: list[float] = []
        current_amount_columns: list[str | None] = []

        in_movements = False  # Track if we're inside the movements section

        def flush_record():
            nonlocal current_fecha, current_comp, current_desc_parts
            nonlocal current_debito, current_credito, current_saldo
            nonlocal current_amounts, current_amount_columns, skipped

            if not current_fecha:
                return

            # Apply fallback heuristic if coordinate lookup didn't classify amounts
            _apply_amount_fallback()

            if current_debito is None and current_credito is None:
                skipped += 1
            else:
                if current_credito is not None:
                    importe = current_credito
                else:
                    importe = -(current_debito or 0)

                concepto = " ".join(current_desc_parts).strip()
                records.append({
                    "fecha":       current_fecha,
                    "banco":       BANCO,
                    "cuenta":      CUENTA,
                    "cbu":         CBU,
                    "moneda":      MONEDA,
                    "comprobante": safe_str(current_comp),
                    "concepto":    safe_str(concepto) if concepto else None,
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
            current_amounts = []
            current_amount_columns = []

        def _apply_amount_fallback():
            """If coordinate lookup failed for some amounts, use positional heuristic.

            Rules:
            - If 2 amounts: first = débito or crédito, second = saldo
            - If 3 amounts: débito, crédito, saldo (rare)
            - The last amount is always saldo
            """
            nonlocal current_debito, current_credito, current_saldo

            # Check if we have unclassified amounts
            unclassified = [
                (amt, col) for amt, col in zip(current_amounts, current_amount_columns)
                if col is None
            ]
            if not unclassified:
                return

            # Re-process all amounts with positional heuristic
            if len(current_amounts) >= 2:
                # Last amount is always saldo
                if current_saldo is None:
                    current_saldo = current_amounts[-1]
                # First amount(s) are débito or crédito
                for amt in current_amounts[:-1]:
                    if current_debito is None and current_credito is None:
                        # Determine from saldo: if saldo > previous state, it's crédito
                        # Simple heuristic: larger amounts tend to be créditos in this context
                        # But safest: if we have saldo info from previous record, compare
                        if records and records[-1].get("saldo") is not None:
                            prev_saldo = records[-1]["saldo"]
                            if current_saldo is not None:
                                if current_saldo > prev_saldo:
                                    current_credito = amt
                                else:
                                    current_debito = amt
                            else:
                                current_debito = amt
                        else:
                            current_debito = amt
            elif len(current_amounts) == 1:
                if current_saldo is None and current_debito is None and current_credito is None:
                    current_saldo = current_amounts[0]

        i = 0
        while i < len(lines):
            line = lines[i].strip()
            i += 1

            if not line:
                continue

            # Section boundary detection — checked regardless of in_movements
            # so that pages starting with "Saldo total" (spillover from
            # previous page) don't accidentally re-enable via dólares headers.
            if "Movimientos en pesos" in line:
                in_movements = True
                continue

            # End of pesos movements section — stop processing this page.
            # "Saldo total" alone (not "Saldo total en cuentas…" from summary)
            # marks the end of movements on this page.
            if line == "Saldo total" or "Movimientos en dólares" in line:
                flush_record()
                break

            if not in_movements:
                # Check if this line has the column header (pages 3+ don't have
                # "Movimientos en pesos" but do have the table header)
                if "Saldo en cuenta" in line:
                    in_movements = True
                continue

            # Skip page headers and table column headers
            if line.startswith("Cuenta Corriente"):
                continue
            if line in ("Fecha", "Comprobante", "Movimiento", "Débito",
                        "Crédito", "Saldo en cuenta"):
                continue
            # Skip combined header line fragments
            if line.startswith("CBU:") or line.startswith("Acuerdo:") or line.startswith("Vencimiento:"):
                continue
            if line.startswith("Emisión"):
                continue
            if line.startswith("Desde:") or line.startswith("Hasta:"):
                continue
            if line.startswith("Total en "):
                continue
            if line == "Período":
                continue
            if line.startswith("* Salvo"):
                continue

            # Skip "Saldo Inicial" — not a real movement
            if "Saldo Inicial" in line:
                continue

            # Check for "pesos AMOUNT" line
            m_pesos = _RE_PESOS_AMOUNT.match(line)
            if m_pesos:
                amount_text = m_pesos.group(1)
                amount = parse_monto_argentino(amount_text)
                if amount is not None and current_fecha:
                    # Try to find the Y position for this amount
                    y_hint = None
                    for y_key_str, y_val in y_mapping.items():
                        if y_key_str.endswith(f":{amount_text}"):
                            y_hint = y_val
                            # Remove from mapping to avoid reuse
                            del y_mapping[y_key_str]
                            break

                    column = _find_amount_column(amount, y_hint, amount_index)

                    current_amounts.append(amount)
                    current_amount_columns.append(column)

                    if column == "debito":
                        current_debito = amount
                    elif column == "credito":
                        current_credito = amount
                    elif column == "saldo":
                        current_saldo = amount
                continue

            # Check for date line (DD/MM/YY) — start of new movement
            m_date = _RE_DATE.match(line)
            if m_date:
                date_str = m_date.group(1)
                rest = m_date.group(2).strip()

                fecha = _parse_fecha_santander(date_str)
                if fecha:
                    # Flush previous movement
                    flush_record()

                    current_fecha = fecha

                    # Rest of the line may contain comprobante and/or description
                    if rest:
                        parts = rest.split(None, 1)
                        # Check if first part is a comprobante (all digits)
                        if parts and _RE_DIGITS_ONLY.match(parts[0]):
                            current_comp = parts[0]
                            # Remaining text after comprobante is description start
                            if len(parts) > 1:
                                current_desc_parts.append(parts[1])
                        else:
                            # No comprobante, all text is description
                            current_desc_parts.append(rest)
                    else:
                        # Date-only line — peek at next line for comprobante
                        if i < len(lines):
                            next_line = lines[i].strip()
                            if next_line and _RE_DIGITS_ONLY.match(next_line):
                                current_comp = next_line
                                i += 1
                    continue

            # If we have an active movement, accumulate description text
            if current_fecha and line:
                # Skip lines that are just page numbers like "2 -  8"
                if re.match(r'^\d+\s*-\s*\d+$', line):
                    continue
                # Skip "pesos" alone (fragment from amount area, no number)
                if line == "pesos":
                    continue
                # Skip standalone number that looks like Acuerdo amount
                # (e.g., "25.000,00" from the page header "Acuerdo: pesos 25.000,00")
                if not current_desc_parts and parse_monto_argentino(line) is not None:
                    stripped = line.replace(".", "").replace(",", "")
                    if stripped.isdigit():
                        continue
                current_desc_parts.append(line)

        # Flush last record on the page
        flush_record()

    doc.close()
    return records, skipped


# ---------------------------------------------------------------------------
# CSV parser
# ---------------------------------------------------------------------------

def _parse_monto_santander(val) -> float | None:
    """Parse monto argentino con paréntesis para negativos: (13.220,36) → -13220.36."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    val = str(val).strip()
    if not val:
        return None
    negativo = val.startswith('(') and val.endswith(')')
    if negativo:
        val = val[1:-1]
    val = val.replace('.', '').replace(',', '.')
    try:
        monto = float(val)
    except ValueError:
        return None
    return -monto if negativo else monto


def _parse_santander_csv(path: Path) -> tuple[list[dict], int]:
    """Parsea un CSV de movimientos bancarios Santander. Returns (records, skipped_count)."""
    # Extraer cuenta de la metadata (línea con "Nro.")
    cuenta = CUENTA
    with open(str(path), 'r', encoding='latin-1') as f:
        for line in f:
            m = re.search(r'Nro\.\s+(\S+)', line)
            if m:
                cuenta = m.group(1)
                break

    df = pd.read_csv(str(path), sep=';', encoding='latin-1', skiprows=6)

    records = []
    skipped = 0

    for _, row in df.iterrows():
        fecha_str = row.get('Fecha')
        if pd.isna(fecha_str):
            continue
        fecha_str = str(fecha_str).strip()
        if not re.match(r'\d{2}/\d{2}/\d{4}$', fecha_str):
            continue

        parts = fecha_str.split('/')
        fecha = f"{parts[2]}-{parts[1]}-{parts[0]}"

        importe = _parse_monto_santander(row.get('Importe'))
        if importe is None:
            skipped += 1
            continue
        saldo = _parse_monto_santander(row.get('Saldo'))

        concepto = safe_str(row.get('Concepto'))
        ref_raw = row.get('Referencia')
        # pandas reads numeric-looking refs (e.g. 000025818) as float → strip .0
        if isinstance(ref_raw, float) and not pd.isna(ref_raw):
            comprobante = str(int(ref_raw))
        else:
            comprobante = safe_str(ref_raw)

        credito = importe if importe >= 0 else None
        debito = abs(importe) if importe < 0 else None

        records.append({
            "fecha": fecha,
            "banco": BANCO,
            "cuenta": cuenta,
            "cbu": CBU,
            "moneda": MONEDA,
            "comprobante": comprobante,
            "concepto": concepto,
            "debito": debito,
            "credito": credito,
            "importe": importe,
            "fecha_valor": None,
            "saldo": saldo,
        })

    return records, skipped


def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "MOVIMIENTOS BANCARIOS" / "BANCO SANTANDER"
    pdf_files = sorted(data_dir.rglob("*.pdf"))
    csv_files = sorted(data_dir.rglob("*.csv"))
    logger.info(f"  {len(pdf_files)} PDFs + {len(csv_files)} CSVs encontrados")

    all_records: list[dict] = []
    total_skipped = 0
    for pdf_path in pdf_files:
        logger.info(f"  Procesando {pdf_path.name}")
        records, skipped = _parse_santander_pdf(pdf_path)
        logger.info(f"    {len(records)} movimientos, {skipped} filas sin importe")
        all_records.extend(records)
        total_skipped += skipped
    for csv_path in csv_files:
        logger.info(f"  Procesando {csv_path.name}")
        records, skipped = _parse_santander_csv(csv_path)
        logger.info(f"    {len(records)} movimientos, {skipped} filas sin importe")
        all_records.extend(records)
        total_skipped += skipped

    if total_skipped:
        logger.warning(f"  {total_skipped} filas totales sin débito ni crédito (salteadas)")
    logger.info(f"  {len(all_records)} movimientos totales a cargar")

    delete_where(conn, "movimiento_bancario", "banco", BANCO)
    return batch_insert(conn, "movimiento_bancario", all_records)

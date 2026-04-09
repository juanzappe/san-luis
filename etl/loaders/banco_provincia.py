"""Loader: BANCO PROVINCIA → movimiento_bancario.

Fuente: data_raw/MOVIMIENTOS BANCARIOS/BANCO PROVINCIA/{year}/*.txt | *.xlsx | *.xls
TXT:  Buscar línea "FECHA,CONCEPTO,IMPORTE,Fecha Valor,Saldo", leer CSV desde ahí.
XLSX: Fila 0 = título, fila 1 = headers reales (Número Secuencia, Fecha, Importe, Saldo, Descripción, …)
XLS:  Excel 97-2003 vía xlrd. Fila 5 = headers, fila 7+ = datos. Fecha tipo '07-abr-2026'.
Fijos: banco='provincia', cuenta='50080/7', cbu='0140191801520805008070', moneda='ARS'
"""

import csv
import io
from pathlib import Path

import pandas as pd
import xlrd

from utils import (
    get_data_raw_path, parse_fecha_argentina,
    safe_str, safe_float, delete_where, batch_insert,
)


MESES_ES = {
    'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'ago': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12,
}


def _parse_fecha_xls(text: str | None) -> str | None:
    """Parse '07-abr-2026' → '2026-04-07'."""
    if not text or not isinstance(text, str):
        return None
    parts = text.strip().split('-')
    if len(parts) != 3:
        return None
    day_s, mes_s, year_s = parts
    mes = MESES_ES.get(mes_s.lower())
    if not mes:
        return None
    try:
        return f"{int(year_s):04d}-{mes:02d}-{int(day_s):02d}"
    except ValueError:
        return None


def _parse_monto_txt(text: str | None) -> float | None:
    """Parse TXT amounts that use dot as decimal (e.g. 34859.26). No thousands sep."""
    if text is None:
        return None
    t = str(text).strip().replace("$", "").strip()
    if not t:
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _parse_banco_txt(path: Path) -> tuple[list[dict], int]:
    """Parsea un TXT de extracto bancario Provincia. Returns (records, skipped_count)."""
    records = []
    skipped = 0
    with open(path, "r", encoding="latin-1") as f:
        lines = f.readlines()

    # Buscar la línea de headers
    header_idx = None
    for i, line in enumerate(lines):
        if line.strip().startswith("FECHA,CONCEPTO,IMPORTE"):
            header_idx = i
            break

    if header_idx is None:
        return records, 0

    # Parsear CSV desde header_idx
    csv_text = "".join(lines[header_idx:])
    reader = csv.DictReader(io.StringIO(csv_text))

    for row in reader:
        fecha = parse_fecha_argentina(row.get("FECHA", "").strip())
        concepto = safe_str(row.get("CONCEPTO"))
        importe_str = safe_str(row.get("IMPORTE"))
        saldo_str = safe_str(row.get("Saldo"))

        if not fecha:
            continue

        # TXT de Provincia usa punto decimal (ej: 34859.26), NO formato argentino.
        # parse_monto_argentino quitaría el punto pensando que es separador de miles → 100x.
        importe = _parse_monto_txt(importe_str)
        saldo = _parse_monto_txt(saldo_str)

        if importe is None:
            skipped += 1
            continue

        # Parsear Fecha Valor (DD-MM)
        fecha_valor_str = safe_str(row.get("Fecha Valor"))
        fecha_valor = None
        if fecha_valor_str and "-" in fecha_valor_str:
            parts = fecha_valor_str.split("-")
            if len(parts) == 2:
                # Tomar el año de la fecha principal
                year = fecha[:4]
                fecha_valor = f"{year}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"

        # Always include both credito and debito for consistent columns
        credito = None
        debito = None
        if importe is not None:
            if importe >= 0:
                credito = importe
            else:
                debito = abs(importe)

        rec = {
            "fecha": fecha,
            "banco": "provincia",
            "cuenta": "50080/7",
            "cbu": "0140191801520805008070",
            "moneda": "ARS",
            "concepto": concepto,
            "importe": importe,
            "fecha_valor": fecha_valor,
            "saldo": saldo,
            "credito": credito,
            "debito": debito,
        }

        records.append(rec)

    return records, skipped


def _parse_banco_xlsx(path: Path) -> tuple[list[dict], int]:
    """Parsea un XLSX de extracto bancario Provincia. Returns (records, skipped_count)."""
    df = pd.read_excel(path, header=1)  # row 0 = título, row 1 = headers reales
    records = []
    skipped = 0

    for _, row in df.iterrows():
        fecha = parse_fecha_argentina(str(row.get("Fecha", "")))
        if not fecha:
            continue

        importe = safe_float(row.get("Importe"))
        if importe is None:
            skipped += 1
            continue

        saldo = safe_float(row.get("Saldo"))
        concepto = safe_str(row.get("Descripción"))

        credito = importe if importe >= 0 else None
        debito = abs(importe) if importe < 0 else None

        records.append({
            "fecha": fecha,
            "banco": "provincia",
            "cuenta": "50080/7",
            "cbu": "0140191801520805008070",
            "moneda": "ARS",
            "concepto": concepto,
            "importe": importe,
            "fecha_valor": None,
            "saldo": saldo,
            "credito": credito,
            "debito": debito,
        })

    return records, skipped


def _parse_banco_xls(path: Path) -> tuple[list[dict], int]:
    """Parsea un XLS (Excel 97-2003) de extracto bancario Provincia. Returns (records, skipped_count)."""
    wb = xlrd.open_workbook(str(path))
    ws = wb.sheet_by_index(0)
    records = []
    skipped = 0

    for row_idx in range(7, ws.nrows):
        fecha_str = ws.cell_value(row_idx, 1)
        fecha = _parse_fecha_xls(fecha_str)
        if not fecha:
            continue

        importe = ws.cell_value(row_idx, 3)
        if not isinstance(importe, (int, float)):
            skipped += 1
            continue

        saldo_val = ws.cell_value(row_idx, 4)
        saldo = saldo_val if isinstance(saldo_val, (int, float)) else None
        concepto = safe_str(ws.cell_value(row_idx, 2))

        credito = importe if importe >= 0 else None
        debito = abs(importe) if importe < 0 else None

        records.append({
            "fecha": fecha,
            "banco": "provincia",
            "cuenta": "50080/7",
            "cbu": "0140191801520805008070",
            "moneda": "ARS",
            "concepto": concepto,
            "importe": importe,
            "fecha_valor": None,
            "saldo": saldo,
            "credito": credito,
            "debito": debito,
        })

    return records, skipped


def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "MOVIMIENTOS BANCARIOS" / "BANCO PROVINCIA"
    txt_files = sorted(data_dir.rglob("*.txt"))
    xlsx_files = sorted(data_dir.rglob("*.xlsx"))
    xls_files = sorted(data_dir.rglob("*.xls"))
    logger.info(f"  {len(txt_files)} TXT + {len(xlsx_files)} XLSX + {len(xls_files)} XLS encontrados")

    all_records = []
    total_skipped = 0
    for txt_path in txt_files:
        logger.info(f"  Procesando {txt_path.name}")
        records, skipped = _parse_banco_txt(txt_path)
        all_records.extend(records)
        total_skipped += skipped
    for xlsx_path in xlsx_files:
        logger.info(f"  Procesando {xlsx_path.name}")
        records, skipped = _parse_banco_xlsx(xlsx_path)
        all_records.extend(records)
        total_skipped += skipped
    for xls_path in xls_files:
        logger.info(f"  Procesando {xls_path.name}")
        records, skipped = _parse_banco_xls(xls_path)
        all_records.extend(records)
        total_skipped += skipped

    if total_skipped:
        logger.warning(f"  {total_skipped} filas salteadas (importe null)")
    logger.info(f"  {len(all_records)} movimientos bancarios a cargar")

    # Delete provincia + insert
    delete_where(conn, "movimiento_bancario", "banco", "provincia")
    count = batch_insert(conn, "movimiento_bancario", all_records)
    return count

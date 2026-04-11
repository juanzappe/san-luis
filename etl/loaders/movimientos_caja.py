"""Loader: MOVIMIENTOS DE CAJA → movimiento_caja.

Fuente: data_raw/MOVIMIENTOS DE CAJA/movcaja_*.xlsx
Sheet: "movcaja" — 9 columnas, ~56k filas
"""

from datetime import datetime

import pandas as pd
from utils import get_data_raw_path, safe_int, safe_float, safe_str, delete_all, batch_insert


def _parse_fecha_caja(val) -> str | None:
    """Parsea fecha del POS (M/D/YYYY H:MM:SS AM/PM) a ISO."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    s = str(val).strip()
    for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M:%S",
                "%d/%m/%Y %I:%M:%S %p", "%d/%m/%Y %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except ValueError:
            continue
    return s


def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "MOVIMIENTOS DE CAJA"
    xlsx_files = sorted(data_dir.glob("*.xlsx"))
    logger.info(f"  {len(xlsx_files)} archivos XLSX encontrados")

    all_records = []

    for xlsx_path in xlsx_files:
        logger.info(f"  Procesando {xlsx_path.name}")
        try:
            df = pd.read_excel(xlsx_path, sheet_name="movcaja", dtype=str)
        except Exception as e:
            logger.warning(f"  No se pudo leer {xlsx_path.name}: {e}")
            continue

        for _, row in df.iterrows():
            fecha = _parse_fecha_caja(row.get("Fecha"))
            if not fecha:
                continue

            all_records.append({
                "fecha": fecha,
                "condicion_pago": safe_str(row.get("Cond. Pago")),
                "documento": safe_str(row.get("Documento")),
                "punto_venta": safe_int(row.get("PV")),
                "numero": safe_int(row.get("Numero")),
                "importe": safe_float(row.get("Importe")),
                "tipo": safe_str(row.get("Tipo")),
                "observacion": safe_str(row.get("Observacion")),
                "tarjeta": safe_str(row.get("Tarjeta")),
            })

    # Deduplicate: source Excel files can contain repeated rows
    before = len(all_records)
    seen = set()
    unique_records = []
    for rec in all_records:
        key = (
            rec["fecha"],
            rec["condicion_pago"],
            rec["documento"],
            rec["punto_venta"],
            rec["numero"],
            rec["importe"],
            rec["tipo"],
        )
        if key not in seen:
            seen.add(key)
            unique_records.append(rec)
    dupes = before - len(unique_records)
    if dupes:
        logger.info(f"  {dupes} duplicados eliminados del fuente ({before} → {len(unique_records)})")
    logger.info(f"  {len(unique_records)} movimientos de caja a cargar")

    delete_all(conn, "movimiento_caja")
    count = batch_insert(conn, "movimiento_caja", unique_records)
    return count

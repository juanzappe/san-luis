"""Loader: MOVIMIENTOS DE CAJA → movimiento_caja.

Fuente: data_raw/MOVIMIENTOS DE CAJA/movcaja_*.xlsx
Sheet: "movcaja" — 9 columnas, ~56k filas
"""

from datetime import datetime

import pandas as pd
from utils import get_data_raw_path, safe_int, safe_float, safe_str


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


def run(sb, logger) -> int:
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

    logger.info(f"  {len(all_records)} movimientos de caja a cargar")

    # Delete + insert
    sb.table("movimiento_caja").delete().neq("id", 0).execute()
    count = 0
    batch_size = 500
    for i in range(0, len(all_records), batch_size):
        batch = all_records[i:i + batch_size]
        sb.table("movimiento_caja").insert(batch).execute()
        count += len(batch)

    return count

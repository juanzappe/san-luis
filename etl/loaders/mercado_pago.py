"""Loader: MERCADO PAGO → movimiento_mp.

Fuente: data_raw/MOVIMIENTOS BANCARIOS/MERCADO PAGO/{year}/*.xlsx
Sheet: "Sheet0" — 5 columnas
Dedup: numero_movimiento (natural key)
"""

import pandas as pd
from utils import get_data_raw_path, safe_str, safe_float, delete_all, batch_insert


def run(conn, logger) -> int:
    data_dir = get_data_raw_path() / "MOVIMIENTOS BANCARIOS" / "MERCADO PAGO"
    xlsx_files = sorted(data_dir.rglob("*.xlsx"))
    logger.info(f"  {len(xlsx_files)} archivos XLSX encontrados")

    all_records = []
    seen_movimientos = set()

    for xlsx_path in xlsx_files:
        logger.info(f"  Procesando {xlsx_path.name}")
        try:
            df = pd.read_excel(xlsx_path, sheet_name="Sheet0", dtype=str)
        except Exception as e:
            logger.warning(f"  No se pudo leer {xlsx_path.name}: {e}")
            continue

        for _, row in df.iterrows():
            num_mov = safe_str(row.get("Número de Movimiento"))
            if not num_mov or num_mov in seen_movimientos:
                continue
            seen_movimientos.add(num_mov)

            fecha = safe_str(row.get("Fecha de Pago"))
            # Fecha viene como ISO con timezone (2024-11-01T09:16:09Z)
            if fecha:
                fecha = fecha.replace("Z", "+00:00") if "Z" in fecha else fecha

            all_records.append({
                "fecha": fecha,
                "tipo_operacion": safe_str(row.get("Tipo de Operación")),
                "numero_movimiento": num_mov,
                "operacion_relacionada": safe_str(row.get("Operación Relacionada")),
                "importe": safe_float(row.get("Importe")),
            })

    logger.info(f"  {len(all_records)} movimientos MP a cargar")

    delete_all(conn, "movimiento_mp")
    count = batch_insert(conn, "movimiento_mp", all_records)
    return count

"""Loader: MERCADO PAGO → movimiento_mp.

Fuente: data_raw/MOVIMIENTOS BANCARIOS/MERCADO PAGO/{year}/*.xlsx | *.csv
XLSX: Sheet "Sheet0" — 5 columnas (reporte estándar de MP)
CSV:  Extracto de cuenta MP — separador ;, skiprows 3, formato argentino
Dedup: numero_movimiento (natural key)

Modo incremental (default): solo inserta movimientos con fecha > max existente.
Modo full (--full): borra todo y recarga.
"""

import csv
from pathlib import Path

import pandas as pd
from utils import (
    get_data_raw_path, safe_str, safe_float, delete_all, batch_insert,
    get_max_value, parse_monto_argentino, parse_fecha_argentina,
)

# Mapeo de TRANSACTION_TYPE (CSV extracto) → tipo_operacion (DB)
_CSV_TYPE_MAP = {
    "Liquidación de dinero": "Cobro",
    "Transferencia enviada": "Retiro de dinero",
    "Pago": "Pago",
    "Impuesto": "Impuesto sobre los Créditos y Débitos en cobros",
    "Comisión": "Costo de Mercado Pago",
    "Retención": "Retención Impuesto Ingresos Brutos Régimen SIRTAC",
}


def _map_tipo_operacion(raw: str | None) -> str | None:
    """Map CSV TRANSACTION_TYPE to standard tipo_operacion, with prefix matching."""
    if not raw:
        return raw
    t = raw.strip()
    # Exact match first
    if t in _CSV_TYPE_MAP:
        return _CSV_TYPE_MAP[t]
    # Prefix match (e.g. "Transferencia enviada a CBU" → "Retiro de dinero")
    for prefix, mapped in _CSV_TYPE_MAP.items():
        if t.startswith(prefix):
            return mapped
    return t  # fallback: keep original


def _parse_mp_csv(path: Path, logger) -> list[dict]:
    """Parse a CSV extracto de cuenta de Mercado Pago."""
    records = []
    try:
        df = pd.read_csv(path, sep=";", encoding="utf-8", skiprows=3)
    except Exception as e:
        logger.warning(f"  No se pudo leer CSV {path.name}: {e}")
        return records

    for _, row in df.iterrows():
        ref_id = safe_str(row.get("REFERENCE_ID"))
        if not ref_id:
            continue

        fecha_str = safe_str(row.get("RELEASE_DATE"))
        fecha = parse_fecha_argentina(fecha_str) if fecha_str else None

        importe_str = safe_str(row.get("TRANSACTION_NET_AMOUNT"))
        importe = parse_monto_argentino(importe_str) if importe_str else None

        tipo_raw = safe_str(row.get("TRANSACTION_TYPE"))
        tipo = _map_tipo_operacion(tipo_raw)

        records.append({
            "fecha": fecha,
            "tipo_operacion": tipo,
            "numero_movimiento": ref_id,
            "operacion_relacionada": None,
            "importe": importe,
        })

    return records


def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "MOVIMIENTOS BANCARIOS" / "MERCADO PAGO"
    xlsx_files = sorted(data_dir.rglob("*.xlsx"))
    csv_files = sorted(data_dir.rglob("*.csv"))
    logger.info(f"  {len(xlsx_files)} XLSX + {len(csv_files)} CSV encontrados")

    if full:
        logger.info("  Modo FULL RELOAD")
        max_fecha = None
    else:
        max_fecha = get_max_value(conn, "movimiento_mp", "fecha")
        if max_fecha:
            logger.info(f"  Modo incremental: solo fecha > {max_fecha}")
        else:
            logger.info("  Tabla vacía, cargando todo")

    all_records = []
    seen_movimientos = set()
    skipped = 0

    # Process CSV files (extracto de cuenta format)
    for csv_path in csv_files:
        logger.info(f"  Procesando CSV {csv_path.name}")
        csv_records = _parse_mp_csv(csv_path, logger)
        for rec in csv_records:
            num_mov = rec["numero_movimiento"]
            if num_mov in seen_movimientos:
                continue
            seen_movimientos.add(num_mov)

            if max_fecha and rec["fecha"] and rec["fecha"] <= max_fecha:
                skipped += 1
                continue

            all_records.append(rec)

    # Process XLSX files (standard MP report format)
    for xlsx_path in xlsx_files:
        logger.info(f"  Procesando {xlsx_path.name}")
        try:
            df = pd.read_excel(xlsx_path, sheet_name="Sheet0")
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

            # Incremental: skip if fecha <= max_fecha
            if max_fecha and fecha and fecha <= max_fecha:
                skipped += 1
                continue

            all_records.append({
                "fecha": fecha,
                "tipo_operacion": safe_str(row.get("Tipo de Operación")),
                "numero_movimiento": num_mov,
                "operacion_relacionada": safe_str(row.get("Operación Relacionada")),
                "importe": safe_float(row.get("Importe")),
            })

    logger.info(f"  {len(all_records)} movimientos nuevos, {skipped} ya existían")

    if full:
        delete_all(conn, "movimiento_mp")

    count = batch_insert(conn, "movimiento_mp", all_records)
    return count

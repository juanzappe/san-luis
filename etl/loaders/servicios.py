"""Loader: SERVICIOS → factura_emitida (Libro IVA Digital fixed-width).

Fuente: data_raw/SERVICIOS/{year}/RESULTADOS_BUSQUEDA (N).zip
Cada ZIP contiene VENTAS.txt + ALICUOTAS.txt (o CABECERA.txt + DETALLE.txt)
Parse: Fixed-width según especificación ARCA para Libro IVA Digital.
Dedup: Mismo key que arca_ingresos (no se deletea — se agrega a lo existente si no hay duplicados).
"""

import zipfile
from pathlib import Path

from utils import get_data_raw_path, safe_int, safe_str, fetch_all, batch_insert


# Spec ARCA Libro IVA Digital — VENTAS.txt posiciones fijas
VENTAS_SPEC = [
    (0, 8, "fecha_comprobante"),
    (8, 3, "tipo_comprobante"),
    (11, 5, "punto_venta"),
    (16, 20, "numero_desde"),
    (36, 20, "numero_hasta"),
    (56, 16, "cod_autorizacion"),
    (72, 2, "tipo_doc_receptor"),
    (74, 20, "nro_doc_receptor"),
    (94, 30, "denominacion_receptor"),
    (124, 15, "imp_total"),
    (139, 15, "imp_neto_no_gravado"),
    (154, 15, "percep_no_categ"),
    (169, 15, "imp_op_exentas"),
    (184, 15, "percepciones_nacionales"),
    (199, 15, "percepciones_iibb"),
    (214, 15, "percepciones_muni"),
    (229, 15, "impuestos_internos"),
    (244, 3, "moneda"),
    (247, 10, "tipo_cambio"),
    (257, 1, "cantidad_alicuotas"),
    (258, 1, "codigo_operacion"),
    (259, 15, "otros_tributos"),
    (274, 8, "fecha_vto_pago"),
]


def _parse_importe_fijo(val: str) -> float | None:
    """Convierte importe fixed-width (15 dígitos, últimos 2 decimales) a float."""
    v = val.strip()
    if not v or v == "0" * len(v):
        return 0.0
    try:
        return int(v) / 100.0
    except ValueError:
        return None


def _parse_fecha_fija(val: str) -> str | None:
    """Convierte YYYYMMDD a YYYY-MM-DD."""
    v = val.strip()
    if len(v) != 8 or v == "00000000":
        return None
    return f"{v[:4]}-{v[4:6]}-{v[6:8]}"


def _parse_ventas_line(line: str) -> dict | None:
    """Parsea una línea de VENTAS.txt según spec fixed-width."""
    if len(line) < 258:
        return None

    record = {}
    for start, length, field in VENTAS_SPEC:
        if start + length <= len(line):
            record[field] = line[start:start + length]

    fecha = _parse_fecha_fija(record.get("fecha_comprobante", ""))
    if not fecha:
        return None

    moneda_raw = record.get("moneda", "PES").strip()
    moneda = "$" if moneda_raw == "PES" else moneda_raw

    return {
        "fecha_emision": fecha,
        "tipo_comprobante": safe_int(record.get("tipo_comprobante")),
        "punto_venta": safe_int(record.get("punto_venta")),
        "numero_desde": safe_int(record.get("numero_desde")),
        "numero_hasta": safe_int(record.get("numero_hasta")),
        "cod_autorizacion": safe_str(record.get("cod_autorizacion")),
        "tipo_doc_receptor": safe_int(record.get("tipo_doc_receptor")),
        "nro_doc_receptor": safe_str(record.get("nro_doc_receptor", "").strip().lstrip("0") or None),
        "denominacion_receptor": safe_str(record.get("denominacion_receptor")),
        "moneda": moneda,
        "tipo_cambio": _parse_importe_fijo(record.get("tipo_cambio", "0")) if record.get("tipo_cambio") else None,
        "imp_total": _parse_importe_fijo(record.get("imp_total", "0")),
        "imp_neto_no_gravado": _parse_importe_fijo(record.get("imp_neto_no_gravado", "0")),
        "imp_op_exentas": _parse_importe_fijo(record.get("imp_op_exentas", "0")),
        "otros_tributos": _parse_importe_fijo(record.get("otros_tributos", "0")),
    }


def run(conn, logger) -> int:
    data_dir = get_data_raw_path() / "SERVICIOS"
    zip_files = sorted(data_dir.rglob("*.zip"))
    logger.info(f"  {len(zip_files)} archivos ZIP encontrados")

    all_records = []
    seen_keys = set()

    # Obtener keys existentes de arca_ingresos para evitar duplicados
    existing = fetch_all(
        conn,
        "SELECT fecha_emision, tipo_comprobante, punto_venta, numero_desde FROM factura_emitida"
    )
    for rec in existing:
        key = (
            str(rec["fecha_emision"]),
            str(rec["tipo_comprobante"]),
            str(rec.get("punto_venta", "")),
            str(rec.get("numero_desde", "")),
        )
        seen_keys.add(key)
    logger.info(f"  {len(seen_keys)} facturas existentes (evitar duplicados)")

    for zip_path in zip_files:
        logger.info(f"  Procesando {zip_path.name}")
        try:
            with zipfile.ZipFile(zip_path) as zf:
                ventas_file = None
                for name in zf.namelist():
                    if name.upper() == "VENTAS.TXT":
                        ventas_file = name
                        break

                if not ventas_file:
                    logger.info(f"    No se encontró VENTAS.txt en {zip_path.name}")
                    continue

                with zf.open(ventas_file) as f:
                    content = f.read().decode("latin-1")

                for line in content.split("\n"):
                    line = line.strip()
                    if not line:
                        continue

                    record = _parse_ventas_line(line)
                    if not record:
                        continue

                    key = (
                        str(record["fecha_emision"]),
                        str(record["tipo_comprobante"]),
                        str(record.get("punto_venta", "")),
                        str(record.get("numero_desde", "")),
                    )
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)

                    all_records.append(record)

        except zipfile.BadZipFile:
            logger.warning(f"  ZIP corrupto: {zip_path.name}")
            continue

    logger.info(f"  {len(all_records)} facturas nuevas de SERVICIOS a cargar")
    count = batch_insert(conn, "factura_emitida", all_records)
    return count

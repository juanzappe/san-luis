"""Loader: PRODUCTOS → tabla producto.

Fuente: data_raw/PRODUCTOS/LISTADO_PRODUCTOS.xlsx
Sheet: "Productos" — 235 filas, 8 columnas
"""

import pandas as pd
from utils import get_data_raw_path, safe_float, safe_str, batch_upsert


def run(conn, logger, full: bool = False) -> int:
    path = get_data_raw_path() / "PRODUCTOS" / "LISTADO_PRODUCTOS.xlsx"
    logger.info(f"Leyendo {path}")

    df = pd.read_excel(path, sheet_name="Productos", dtype=str)
    logger.info(f"  {len(df)} filas leídas")

    records = []
    for _, row in df.iterrows():
        codigo = safe_str(row.get("*Codigo"))
        descripcion = safe_str(row.get("*Descripcion"))
        if not codigo or not descripcion:
            continue

        records.append({
            "codigo_pos": codigo,
            "descripcion": descripcion,
            "familia": safe_str(row.get("Familia")),
            "costo": safe_float(row.get("*Costo")),
            "precio_venta": safe_float(row.get("*Precio de Venta")),
            "margen": safe_float(row.get("Margen de Ganancia")),
            "proveedor_nombre": safe_str(row.get("Proveedor")),
            "proveedor_cuit": safe_str(row.get("CUIT Proveedor")),
        })

    logger.info(f"  {len(records)} productos a cargar")
    count = batch_upsert(conn, "producto", records, on_conflict="codigo_pos")
    return count

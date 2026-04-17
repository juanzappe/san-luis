"""Loader: SEGMENTACION → categoria_egreso, sector_cliente, UPDATE cliente/proveedor.

Fuente: data_raw/SEGMENTACION/*.csv (4 archivos)
  - segmentacion_costos_categorias.csv → upsert categoria_egreso
  - segmentacion_sectores.csv → insert sector_cliente
  - segmentacion_clientes.csv → UPDATE cliente (tipo_entidad, clasificacion) por CUIT
  - segmentacion_proveedores.csv → UPDATE proveedor (tipo_costo, categoria_egreso) por Denominacion
"""

import pandas as pd
from psycopg2.extras import execute_batch

from utils import (
    get_data_raw_path, safe_str,
    batch_upsert, batch_insert, delete_all,
)


def _read_csv(path):
    """Lee CSV con encoding flexible (UTF-8 BOM o Latin-1)."""
    return pd.read_csv(path, encoding="utf-8-sig", dtype=str, keep_default_na=False)


def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "SEGMENTACION"
    if not data_dir.exists():
        logger.warning(f"  Directorio {data_dir} no encontrado, saltando")
        return 0

    total = 0

    # 1. Categorías de egreso (catálogo de 26 categorías)
    cat_path = data_dir / "segmentacion_costos_categorias.csv"
    if cat_path.exists():
        df = _read_csv(cat_path)
        logger.info(f"  {len(df)} categorías de egreso a cargar")
        categorias = [
            {
                "nombre": safe_str(row.get("CategoriaEgreso") or row.get("Categoria") or row.get("nombre")),
                "tipo_costo": safe_str(row.get("TipoCosto") or row.get("tipo_costo")) or "variable",
            }
            for row in df.to_dict("records")
            if safe_str(row.get("CategoriaEgreso") or row.get("Categoria") or row.get("nombre"))
        ]
        if categorias:
            count = batch_upsert(conn, "categoria_egreso", categorias, on_conflict="nombre")
            logger.info(f"  ✓ {count} categorías de egreso")
            total += count
    else:
        logger.warning(f"  {cat_path.name} no encontrado")

    # 2. Sectores de clientes (catálogo de 28 sectores)
    sec_path = data_dir / "segmentacion_sectores.csv"
    if sec_path.exists():
        df = _read_csv(sec_path)
        logger.info(f"  {len(df)} sectores de clientes a cargar")
        sectores = [
            {"nombre": safe_str(row.get("Sector") or row.get("Categoria") or row.get("nombre") or row.get("Clasificacion"))}
            for row in df.to_dict("records")
            if safe_str(row.get("Sector") or row.get("Categoria") or row.get("nombre") or row.get("Clasificacion"))
        ]
        if sectores:
            delete_all(conn, "sector_cliente")
            count = batch_insert(conn, "sector_cliente", sectores)
            logger.info(f"  ✓ {count} sectores de clientes")
            total += count
    else:
        logger.warning(f"  {sec_path.name} no encontrado")

    # 3. Segmentación de clientes → UPDATE cliente
    cli_path = data_dir / "segmentacion_clientes.csv"
    if cli_path.exists():
        df = _read_csv(cli_path)
        logger.info(f"  {len(df)} clientes a segmentar")
        updates = [
            (safe_str(row.get("TipoEntidad")), safe_str(row.get("Clasificacion")), safe_str(row.get("CUIT")))
            for row in df.to_dict("records")
            if safe_str(row.get("CUIT"))
        ]
        with conn.cursor() as cur:
            execute_batch(
                cur,
                "UPDATE cliente SET tipo_entidad = %s, clasificacion = %s WHERE cuit = %s",
                updates,
                page_size=500,
            )
        updated = len(updates)
        logger.info(f"  ✓ {updated} clientes actualizados")
        total += updated
    else:
        logger.warning(f"  {cli_path.name} no encontrado")

    # 4. Segmentación de proveedores → UPDATE proveedor (match por Denominacion, no CUIT)
    prov_path = data_dir / "segmentacion_proveedores.csv"
    if prov_path.exists():
        df = _read_csv(prov_path)
        logger.info(f"  {len(df)} proveedores a segmentar")
        prov_rows = [
            (safe_str(row.get("TipoCosto")), safe_str(row.get("CategoriaEgreso")), safe_str(row.get("Denominacion")))
            for row in df.to_dict("records")
            if safe_str(row.get("Denominacion"))
        ]
        with conn.cursor() as cur:
            execute_batch(
                cur,
                "UPDATE proveedor SET tipo_costo = %s, categoria_egreso = %s "
                "WHERE UPPER(TRIM(razon_social)) = UPPER(TRIM(%s))",
                prov_rows,
                page_size=500,
            )
        updated = len(prov_rows)
        logger.info(f"  ✓ {updated} proveedores actualizados")
        total += updated
    else:
        logger.warning(f"  {prov_path.name} no encontrado")

    return total

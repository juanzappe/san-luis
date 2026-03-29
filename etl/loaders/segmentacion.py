"""Loader: SEGMENTACION → categoria_egreso, sector_cliente, UPDATE cliente/proveedor.

Fuente: data_raw/SEGMENTACION/*.csv (4 archivos)
  - segmentacion_costos_categorias.csv → upsert categoria_egreso
  - segmentacion_sectores.csv → insert sector_cliente
  - segmentacion_clientes.csv → UPDATE cliente (tipo_entidad, clasificacion) por CUIT
  - segmentacion_proveedores.csv → UPDATE proveedor (tipo_costo, categoria_egreso) por CUIT
"""

import pandas as pd

from utils import (
    get_data_raw_path, safe_str,
    batch_upsert, batch_insert, delete_all,
)


def _read_csv(path):
    """Lee CSV con encoding flexible (UTF-8 BOM o Latin-1)."""
    return pd.read_csv(path, encoding="utf-8-sig", dtype=str, keep_default_na=False)


def run(conn, logger) -> int:
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
        categorias = []
        for _, row in df.iterrows():
            nombre = safe_str(row.get("CategoriaEgreso") or row.get("Categoria") or row.get("nombre"))
            if not nombre:
                continue
            tipo_costo = safe_str(row.get("TipoCosto") or row.get("tipo_costo")) or "variable"
            categorias.append({
                "nombre": nombre,
                "tipo_costo": tipo_costo,
            })
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
        sectores = []
        for _, row in df.iterrows():
            nombre = safe_str(row.get("Sector") or row.get("nombre") or row.get("Clasificacion"))
            if not nombre:
                continue
            sectores.append({"nombre": nombre})
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
        updated = 0
        with conn.cursor() as cur:
            for _, row in df.iterrows():
                cuit = safe_str(row.get("CUIT"))
                if not cuit:
                    continue
                tipo_entidad = safe_str(row.get("TipoEntidad"))
                clasificacion = safe_str(row.get("Clasificacion"))
                cur.execute(
                    "UPDATE cliente SET tipo_entidad = %s, clasificacion = %s WHERE cuit = %s",
                    (tipo_entidad, clasificacion, cuit),
                )
                updated += cur.rowcount
        logger.info(f"  ✓ {updated} clientes actualizados")
        total += updated
    else:
        logger.warning(f"  {cli_path.name} no encontrado")

    # 4. Segmentación de proveedores → UPDATE proveedor
    prov_path = data_dir / "segmentacion_proveedores.csv"
    if prov_path.exists():
        df = _read_csv(prov_path)
        logger.info(f"  {len(df)} proveedores a segmentar")
        updated = 0
        with conn.cursor() as cur:
            for _, row in df.iterrows():
                cuit = safe_str(row.get("CUIT"))
                if not cuit:
                    continue
                tipo_costo = safe_str(row.get("TipoCosto"))
                cat_egreso = safe_str(row.get("CategoriaEgreso"))
                cur.execute(
                    "UPDATE proveedor SET tipo_costo = %s, categoria_egreso = %s WHERE cuit = %s",
                    (tipo_costo, cat_egreso, cuit),
                )
                updated += cur.rowcount
        logger.info(f"  ✓ {updated} proveedores actualizados")
        total += updated
    else:
        logger.warning(f"  {prov_path.name} no encontrado")

    return total

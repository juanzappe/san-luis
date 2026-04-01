"""Loader: ARCA_EGRESOS → factura_recibida + proveedor.

Fuente: data_raw/ARCA_EGRESOS/*.csv (7 archivos, ; delimitado, UTF-8 BOM)
Side effect: upsert proveedores únicos por nro_doc_emisor WHERE tipo_doc=80

Modo incremental (default): solo inserta facturas con fecha_emision > max existente.
Modo full (--full): borra todo y recarga.
"""

from utils import (
    get_data_raw_path, clean_arca_csv, parse_monto_argentino,
    safe_int, safe_str, batch_upsert, batch_insert, delete_all, get_max_value,
)


def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "ARCA_EGRESOS"
    csv_files = sorted(data_dir.glob("*.csv"))
    logger.info(f"  {len(csv_files)} archivos CSV encontrados")

    if full:
        logger.info("  Modo FULL RELOAD")
        max_fecha = None
    else:
        max_fecha = get_max_value(conn, "factura_recibida", "fecha_emision")
        if max_fecha:
            logger.info(f"  Modo incremental: solo fecha_emision > {max_fecha}")
        else:
            logger.info("  Tabla vacía, cargando todo")

    all_facturas = []
    proveedores_seen = {}  # nro_doc → denominacion
    skipped = 0

    for csv_path in csv_files:
        logger.info(f"  Procesando {csv_path.name}")
        df = clean_arca_csv(csv_path)

        for _, row in df.iterrows():
            fecha = safe_str(row.get("Fecha de Emisión"))
            tipo_comp = safe_int(row.get("Tipo de Comprobante"))
            pv = safe_int(row.get("Punto de Venta"))
            num_desde = safe_int(row.get("Número Desde"))

            if not fecha or tipo_comp is None:
                continue

            # Incremental: skip if fecha <= max_fecha
            if max_fecha and fecha <= max_fecha:
                skipped += 1
                continue

            # Recopilar proveedores con CUIT (tipo_doc=80)
            tipo_doc_emisor = safe_int(row.get("Tipo Doc. Emisor"))
            nro_doc_emisor = safe_str(row.get("Nro. Doc. Emisor"))
            denominacion_emisor = safe_str(row.get("Denominación Emisor"))
            if tipo_doc_emisor == 80 and nro_doc_emisor and nro_doc_emisor != "0":
                proveedores_seen[nro_doc_emisor] = denominacion_emisor

            factura = {
                "fecha_emision": fecha,
                "tipo_comprobante": tipo_comp,
                "punto_venta": pv,
                "numero_desde": num_desde,
                "numero_hasta": safe_int(row.get("Número Hasta")),
                "cod_autorizacion": safe_str(row.get("Cód. Autorización")),
                "tipo_doc_emisor": tipo_doc_emisor,
                "nro_doc_emisor": nro_doc_emisor,
                "denominacion_emisor": denominacion_emisor,
                "tipo_doc_receptor": safe_int(row.get("Tipo Doc. Receptor")),
                "nro_doc_receptor": safe_str(row.get("Nro. Doc. Receptor")),
                "tipo_cambio": parse_monto_argentino(row.get("Tipo Cambio")),
                "moneda": safe_str(row.get("Moneda")),
                "iva_0_neto": parse_monto_argentino(row.get("Imp. Neto Gravado IVA 0%")),
                "iva_2_5": parse_monto_argentino(row.get("IVA 2,5%")),
                "iva_2_5_neto": parse_monto_argentino(row.get("Imp. Neto Gravado IVA 2,5%")),
                "iva_5": parse_monto_argentino(row.get("IVA 5%")),
                "iva_5_neto": parse_monto_argentino(row.get("Imp. Neto Gravado IVA 5%")),
                "iva_10_5": parse_monto_argentino(row.get("IVA 10,5%")),
                "iva_10_5_neto": parse_monto_argentino(row.get("Imp. Neto Gravado IVA 10,5%")),
                "iva_21": parse_monto_argentino(row.get("IVA 21%")),
                "iva_21_neto": parse_monto_argentino(row.get("Imp. Neto Gravado IVA 21%")),
                "iva_27": parse_monto_argentino(row.get("IVA 27%")),
                "iva_27_neto": parse_monto_argentino(row.get("Imp. Neto Gravado IVA 27%")),
                "imp_neto_gravado_total": parse_monto_argentino(row.get("Imp. Neto Gravado Total")),
                "imp_neto_no_gravado": parse_monto_argentino(row.get("Imp. Neto No Gravado")),
                "imp_op_exentas": parse_monto_argentino(row.get("Imp. Op. Exentas")),
                "otros_tributos": parse_monto_argentino(row.get("Otros Tributos")),
                "total_iva": parse_monto_argentino(row.get("Total IVA")),
                "imp_total": parse_monto_argentino(row.get("Imp. Total")),
            }
            all_facturas.append(factura)

    # Upsert proveedores (always, even incremental)
    if proveedores_seen:
        proveedores_data = [
            {"cuit": cuit, "razon_social": nombre or "SIN DENOMINACIÓN", "tipo_doc": 80}
            for cuit, nombre in proveedores_seen.items()
        ]
        logger.info(f"  {len(proveedores_data)} proveedores a upsert")
        batch_upsert(conn, "proveedor", proveedores_data, on_conflict="cuit")

    # Insert facturas
    logger.info(f"  {len(all_facturas)} facturas nuevas, {skipped} ya existían")

    if full:
        delete_all(conn, "factura_recibida")

    count = batch_insert(conn, "factura_recibida", all_facturas)
    return count

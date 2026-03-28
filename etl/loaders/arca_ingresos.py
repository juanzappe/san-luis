"""Loader: ARCA_INGRESOS → factura_emitida + cliente.

Fuente: data_raw/ARCA_INGRESOS/*.csv (7 archivos, ; delimitado, UTF-8 BOM)
Side effect: upsert clientes únicos por nro_doc_receptor WHERE tipo_doc=80
Dedup: fecha_emision + tipo_comprobante + punto_venta + numero_desde
"""

from pathlib import Path
from utils import (
    get_data_raw_path, clean_arca_csv, parse_monto_argentino,
    safe_int, safe_str, batch_upsert,
)


def run(sb, logger) -> int:
    data_dir = get_data_raw_path() / "ARCA_INGRESOS"
    csv_files = sorted(data_dir.glob("*.csv"))
    logger.info(f"  {len(csv_files)} archivos CSV encontrados")

    all_facturas = []
    clientes_seen = {}  # nro_doc → denominacion

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

            # Recopilar clientes con CUIT (tipo_doc=80)
            tipo_doc = safe_int(row.get("Tipo Doc. Receptor"))
            nro_doc = safe_str(row.get("Nro. Doc. Receptor"))
            denominacion = safe_str(row.get("Denominación Receptor"))
            if tipo_doc == 80 and nro_doc and nro_doc != "0":
                clientes_seen[nro_doc] = denominacion

            factura = {
                "fecha_emision": fecha,
                "tipo_comprobante": tipo_comp,
                "punto_venta": pv,
                "numero_desde": num_desde,
                "numero_hasta": safe_int(row.get("Número Hasta")),
                "cod_autorizacion": safe_str(row.get("Cód. Autorización")),
                "tipo_doc_receptor": tipo_doc,
                "nro_doc_receptor": nro_doc,
                "denominacion_receptor": denominacion,
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

    # Upsert clientes
    if clientes_seen:
        clientes_data = [
            {"cuit": cuit, "razon_social": nombre or "SIN DENOMINACIÓN", "tipo_doc": 80}
            for cuit, nombre in clientes_seen.items()
        ]
        logger.info(f"  {len(clientes_data)} clientes a upsert")
        batch_upsert(sb, "cliente", clientes_data, on_conflict="cuit")

    # Upsert facturas
    logger.info(f"  {len(all_facturas)} facturas emitidas a cargar")
    # Truncate + insert approach: delete existing first to avoid complex composite key upsert
    # Use insert since Supabase doesn't support composite on_conflict easily
    # First delete all existing records
    sb.table("factura_emitida").delete().neq("id", 0).execute()
    count = 0
    batch_size = 500
    for i in range(0, len(all_facturas), batch_size):
        batch = all_facturas[i:i + batch_size]
        sb.table("factura_emitida").insert(batch).execute()
        count += len(batch)

    return count

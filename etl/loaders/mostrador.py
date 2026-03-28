"""Loader: MOSTRADOR → venta + venta_detalle.

Fuente: data_raw/MOSTRADOR/{year}/*.xlsx
Sheet: "ventas_detalle" — cada fila es una línea de detalle.
Paso 1: Agrupar por idVenta → insertar venta (header)
Paso 2: Insertar venta_detalle con FK al venta_id
"""

from datetime import datetime
from pathlib import Path

import pandas as pd
from utils import get_data_raw_path, safe_int, safe_float, safe_str


def _parse_fecha_mostrador(val) -> str | None:
    """Parsea fechas del POS (DD/MM/YYYY HH:MM:SS) a ISO."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    s = str(val).strip()
    for fmt in ("%d/%m/%Y %I:%M:%S %p", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except ValueError:
            continue
    return s


def run(sb, logger) -> int:
    data_dir = get_data_raw_path() / "MOSTRADOR"
    xlsx_files = sorted(data_dir.rglob("*.xlsx"))
    logger.info(f"  {len(xlsx_files)} archivos XLSX encontrados")

    # Delete existing to handle full reload
    sb.table("venta_detalle").delete().neq("id", 0).execute()
    sb.table("venta").delete().neq("id", 0).execute()

    total_ventas = 0
    total_detalles = 0

    for xlsx_path in xlsx_files:
        logger.info(f"  Procesando {xlsx_path.name}")
        try:
            df = pd.read_excel(xlsx_path, sheet_name="ventas_detalle", dtype=str)
        except Exception as e:
            logger.warning(f"  No se pudo leer {xlsx_path.name}: {e}")
            continue

        if df.empty:
            continue

        # Agrupar por idVenta para headers de venta
        ventas_grouped = {}
        for _, row in df.iterrows():
            id_venta = safe_str(row.get("idVenta"))
            if not id_venta:
                continue
            if id_venta not in ventas_grouped:
                ventas_grouped[id_venta] = {
                    "header": row,
                    "detalles": [],
                }
            ventas_grouped[id_venta]["detalles"].append(row)

        # Insertar ventas en batches
        venta_records = []
        for id_venta, data in ventas_grouped.items():
            h = data["header"]
            anulado = safe_str(h.get("Anulado"))
            venta_records.append({
                "id_venta_pos": id_venta,
                "fecha": _parse_fecha_mostrador(h.get("Fecha")),
                "fuente": "pos",
                "tipo_comprobante": safe_str(h.get("Tipo")),
                "punto_venta": safe_int(h.get("PV")),
                "numero": safe_int(h.get("Numero")),
                "comprobante": safe_str(h.get("Comprobante")),
                "condicion_venta": safe_str(h.get("Cond.Vta.")),
                "condicion_pago": safe_str(h.get("Cond.Pago")),
                "cliente_nombre": safe_str(h.get("Cliente")),
                "cliente_cuit": safe_str(h.get("CUIT")),
                "monto_total": safe_float(h.get("TotalVenta")),
                "anulado": anulado is not None and anulado.lower() == "si",
                "operador": safe_str(h.get("OperadorCreacion")),
            })

        # Insert ventas in batches and collect IDs
        batch_size = 500
        venta_id_map = {}  # id_venta_pos → db id

        for i in range(0, len(venta_records), batch_size):
            batch = venta_records[i:i + batch_size]
            result = sb.table("venta").insert(batch).execute()
            for rec in result.data:
                venta_id_map[rec["id_venta_pos"]] = rec["id"]
            total_ventas += len(batch)

        # Insertar detalles
        detalle_records = []
        for id_venta, data in ventas_grouped.items():
            venta_db_id = venta_id_map.get(id_venta)
            if not venta_db_id:
                continue
            for det in data["detalles"]:
                detalle_records.append({
                    "venta_id": venta_db_id,
                    "id_producto_pos": safe_str(det.get("idProducto")),
                    "codigo_producto": safe_str(det.get("sCodProducto")),
                    "producto": safe_str(det.get("Producto")),
                    "costo": safe_float(det.get("Costo")),
                    "precio_unitario": safe_float(det.get("Precio U")),
                    "cantidad": safe_float(det.get("Cantidad")),
                    "neto": safe_float(det.get("Neto")),
                    "descuentos": safe_float(det.get("Descuentos")),
                    "impuestos": safe_float(det.get("Impuestos")),
                    "familia": safe_str(det.get("Familia")),
                    "proveedor_pos": safe_str(det.get("Proveedor")),
                    "ean": safe_str(det.get("EAN")),
                    "alicuota_iva": safe_float(det.get("Alic IVA")),
                    "alicuota_dgr": safe_float(det.get("Alic DGR")),
                })

        for i in range(0, len(detalle_records), batch_size):
            batch = detalle_records[i:i + batch_size]
            sb.table("venta_detalle").insert(batch).execute()
            total_detalles += len(batch)

    logger.info(f"  {total_ventas} ventas, {total_detalles} detalles")
    return total_ventas + total_detalles

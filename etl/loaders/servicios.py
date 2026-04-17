"""Loader: SERVICIOS → factura_emitida + factura_emitida_detalle.

Fuente: data_raw/SERVICIOS/{year}/RESULTADOS_BUSQUEDA (N).zip
Dos tipos de ZIP:
  Tipo 1: VENTAS.txt + ALICUOTAS.txt (Libro IVA Digital fixed-width)
  Tipo 2: CABECERA.txt + DETALLE.txt (Comprobantes con line items)

Dedup: Mismo key que arca_ingresos (fecha_emision, tipo_comprobante, punto_venta, numero_desde).
"""

import zipfile
from pathlib import Path

from psycopg2.extras import execute_batch

from utils import (
    get_data_raw_path, safe_int, safe_str,
    fetch_all, batch_insert, batch_insert_returning,
    delete_all,
)


# ---------------------------------------------------------------------------
# Amount / date parsing helpers
# ---------------------------------------------------------------------------

def _parse_importe(val: str, divisor: float = 100.0) -> float | None:
    """Parse fixed-width amount field. Default divisor 100 (ARCA format 15,2)."""
    v = val.strip()
    if not v or v == "0" * len(v):
        return 0.0
    try:
        return int(v) / divisor
    except ValueError:
        return None


def _parse_fecha(val: str) -> str | None:
    """Convert YYYYMMDD to YYYY-MM-DD."""
    v = val.strip()
    if len(v) != 8 or v == "00000000":
        return None
    return f"{v[:4]}-{v[4:6]}-{v[6:8]}"


# ---------------------------------------------------------------------------
# Tipo 1: VENTAS.txt (Libro IVA Digital)
# ---------------------------------------------------------------------------

# Corrected spec — no cod_autorizacion field in these files
VENTAS_SPEC = [
    (0, 8, "fecha_comprobante"),
    (8, 3, "tipo_comprobante"),
    (11, 5, "punto_venta"),
    (16, 20, "numero_desde"),
    (36, 20, "numero_hasta"),
    (56, 2, "tipo_doc_receptor"),
    (58, 20, "nro_doc_receptor"),
    (78, 30, "denominacion_receptor"),
    (108, 15, "imp_total"),
    (123, 15, "imp_neto_no_gravado"),
    (138, 15, "percep_no_categ"),
    (153, 15, "imp_op_exentas"),
    (168, 15, "percepciones_nacionales"),
    (183, 15, "percepciones_iibb"),
    (198, 15, "percepciones_muni"),
    (213, 15, "impuestos_internos"),
    (228, 3, "moneda"),
    (231, 10, "tipo_cambio"),  # Format 10,6 → divisor 1_000_000
    (241, 1, "cantidad_alicuotas"),
    (242, 1, "codigo_operacion"),
    (243, 15, "otros_tributos"),
    (258, 8, "fecha_vto_pago"),
]


# ALICUOTAS.txt: alic_id (4 chars) → (neto_col, iva_col) in factura_emitida.
# Keys are 4-digit codes as they appear in the file ("0005" = 21%).
ALICUOTA_FIELDS = {
    "0002": ("iva_2_5_neto", "iva_2_5"),
    "0003": ("iva_0_neto", None),
    "0004": ("iva_10_5_neto", "iva_10_5"),
    "0005": ("iva_21_neto", "iva_21"),
    "0006": ("iva_27_neto", "iva_27"),
}


def _parse_alicuotas_content(content: str) -> dict:
    """Parse ALICUOTAS.txt → dict keyed by (tipo_comp, pv, nro) → list of (alic_id, neto, iva).

    ARCA Libro IVA Digital ALICUOTAS.txt format (62 chars per line):
      [0:3]   Tipo comprobante (3)
      [3:8]   Punto de venta (5)
      [8:28]  Número de comprobante (20)
      [28:43] Importe neto gravado (15,2)
      [43:47] Alícuota IVA (4)   ← 4 chars, not 3
      [47:62] Impuesto liquidado (15,2)
    """
    result = {}
    for line in content.split("\n"):
        line = line.rstrip("\r")
        if len(line) < 62:
            continue
        tipo_comp = safe_int(line[0:3])
        pv = safe_int(line[3:8])
        nro = safe_int(line[8:28])
        neto = _parse_importe(line[28:43])
        alic_id = line[43:47].strip()
        iva = _parse_importe(line[47:62])
        if tipo_comp is None or pv is None or nro is None:
            continue
        key = (tipo_comp, pv, nro)
        result.setdefault(key, []).append((alic_id, neto, iva))
    return result


def _parse_ventas_line(line: str) -> dict | None:
    """Parse one line of VENTAS.txt into a factura_emitida record."""
    if len(line) < 240:
        return None

    fields = {}
    for start, length, name in VENTAS_SPEC:
        if start + length <= len(line):
            fields[name] = line[start:start + length]

    fecha = _parse_fecha(fields.get("fecha_comprobante", ""))
    if not fecha:
        return None

    moneda_raw = fields.get("moneda", "PES").strip()
    moneda = "$" if moneda_raw == "PES" else moneda_raw

    return {
        "fecha_emision": fecha,
        "tipo_comprobante": safe_int(fields.get("tipo_comprobante")),
        "punto_venta": safe_int(fields.get("punto_venta")),
        "numero_desde": safe_int(fields.get("numero_desde")),
        "numero_hasta": safe_int(fields.get("numero_hasta")),
        "tipo_doc_receptor": safe_int(fields.get("tipo_doc_receptor")),
        "nro_doc_receptor": safe_str(
            (fields.get("nro_doc_receptor") or "").strip().lstrip("0") or None
        ),
        "denominacion_receptor": safe_str(fields.get("denominacion_receptor")),
        "moneda": moneda,
        "tipo_cambio": _parse_importe(fields.get("tipo_cambio", "0"), divisor=1_000_000.0),
        "imp_total": _parse_importe(fields.get("imp_total", "0")),
        "imp_neto_no_gravado": _parse_importe(
            fields.get("imp_neto_no_gravado", "0")
        ),
        "imp_op_exentas": _parse_importe(fields.get("imp_op_exentas", "0")),
        "otros_tributos": _parse_importe(fields.get("otros_tributos", "0")),
    }


# ---------------------------------------------------------------------------
# Tipo 2: CABECERA.txt
# ---------------------------------------------------------------------------

def _parse_cabecera_line(line: str) -> dict | None:
    """Parse one line of CABECERA.txt into a factura_emitida record."""
    if len(line) < 260:
        return None

    # tipo_registro at [0:1] — only process '1'
    if line[0] != "1":
        return None

    fecha = _parse_fecha(line[1:9])
    if not fecha:
        return None

    moneda_raw = line[243:246].strip()
    moneda = "$" if moneda_raw == "PES" else moneda_raw

    cod_auth = safe_str(line[259:275]) if len(line) >= 275 else None

    return {
        "fecha_emision": fecha,
        "tipo_comprobante": safe_int(line[9:11]),
        "punto_venta": safe_int(line[12:16]),
        "numero_desde": safe_int(line[16:24]),
        "numero_hasta": safe_int(line[24:32]),
        "tipo_doc_receptor": safe_int(line[35:37]),
        "nro_doc_receptor": safe_str(
            line[37:48].strip().lstrip("0") or None
        ),
        "denominacion_receptor": safe_str(line[48:78]),
        "moneda": moneda,
        "cod_autorizacion": cod_auth,
        "imp_total": _parse_importe(line[78:93]),
        "imp_neto_no_gravado": _parse_importe(line[93:108]),
        "imp_neto_gravado_total": _parse_importe(line[108:123]),
        "total_iva": _parse_importe(line[123:138]),
        "imp_op_exentas": _parse_importe(line[138:153]),
    }


# ---------------------------------------------------------------------------
# Tipo 2: DETALLE.txt
# ---------------------------------------------------------------------------

def _parse_detalle_line(line: str) -> dict | None:
    """Parse one line of DETALLE.txt into a detalle record + match key."""
    if len(line) < 114:
        return None

    tipo_comp = safe_int(line[0:2])
    punto_venta = safe_int(line[11:15])
    numero_desde = safe_int(line[15:23])

    if tipo_comp is None or punto_venta is None or numero_desde is None:
        return None

    descripcion = line[114:189].strip() if len(line) >= 114 else None

    return {
        # Match key fields (used to link to factura_emitida, not inserted)
        "_tipo_comprobante": tipo_comp,
        "_punto_venta": punto_venta,
        "_numero_desde": numero_desde,
        # Actual detalle fields
        "renglon": safe_int(line[112:114]),
        "descripcion": descripcion,
        # Divisors verificados contra header (cantidad × precio = importe = imp_total):
        #   cantidad:        15,9 → divisor 10^9  (ej: raw "000014200000070" → 14.2)
        #   precio_unitario: 15,2 → divisor 10^2  (ej: raw "000000008000000" → 80000)
        #   importe:         15,1 → divisor 10   (per-renglón gross, matches imp_total)
        "cantidad": _parse_importe(line[31:46], divisor=1_000_000_000.0),
        "precio_unitario": _parse_importe(line[46:61], divisor=100.0),
        "bonificacion": _parse_importe(line[61:76], divisor=10_000.0),
        "importe": _parse_importe(line[91:106], divisor=10.0),
        "alicuota_iva": _parse_importe(line[106:111], divisor=100.0),
        "codigo_operacion": safe_str(line[111:112]),
    }


# ---------------------------------------------------------------------------
# ZIP classification and processing
# ---------------------------------------------------------------------------

def _classify_zip(zf: zipfile.ZipFile) -> str | None:
    """Return 'ventas' or 'cabecera' based on ZIP contents, or None."""
    names_upper = [n.upper() for n in zf.namelist()]
    if any(n == "CABECERA.TXT" for n in names_upper):
        return "cabecera"
    if any(n == "VENTAS.TXT" for n in names_upper):
        return "ventas"
    return None


def _find_file(zf: zipfile.ZipFile, target: str) -> str | None:
    """Find a file in ZIP by case-insensitive name match."""
    for name in zf.namelist():
        if name.upper() == target.upper():
            return name
    return None


def _read_zip_file(zf: zipfile.ZipFile, filename: str) -> str:
    """Read a file from ZIP as Latin-1 text."""
    with zf.open(filename) as f:
        return f.read().decode("latin-1")


# ---------------------------------------------------------------------------
# Main loader
# ---------------------------------------------------------------------------

def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "SERVICIOS"
    zip_files = sorted(data_dir.rglob("*.zip"))
    logger.info(f"  {len(zip_files)} archivos ZIP encontrados")

    if full:
        logger.info("  Modo FULL RELOAD: borrando facturas PV=6 y detalles")
        delete_all(conn, "factura_emitida_detalle")
        # Only delete PV=6 facturas (servicios), not arca_ingresos ones
        with conn.cursor() as cur:
            cur.execute("DELETE FROM factura_emitida WHERE punto_venta = 6")

    # Load existing factura_emitida keys for dedup
    existing = fetch_all(
        conn,
        "SELECT fecha_emision, tipo_comprobante, punto_venta, numero_desde "
        "FROM factura_emitida"
    )
    seen_keys = set()
    for rec in existing:
        key = (
            str(rec["fecha_emision"]),
            str(rec["tipo_comprobante"]),
            str(rec.get("punto_venta", "")),
            str(rec.get("numero_desde", "")),
        )
        seen_keys.add(key)
    logger.info(f"  {len(seen_keys)} facturas existentes (evitar duplicados)")

    # Classify ZIPs
    ventas_zips = []
    cabecera_zips = []

    for zip_path in zip_files:
        try:
            with zipfile.ZipFile(zip_path) as zf:
                tipo = _classify_zip(zf)
                if tipo == "ventas":
                    ventas_zips.append(zip_path)
                elif tipo == "cabecera":
                    cabecera_zips.append(zip_path)
                else:
                    logger.info(f"    {zip_path.name}: no VENTAS.txt ni CABECERA.txt, saltando")
        except zipfile.BadZipFile:
            logger.warning(f"  ZIP corrupto: {zip_path.name}")

    logger.info(f"  Tipo 1 (VENTAS): {len(ventas_zips)}, Tipo 2 (CABECERA+DETALLE): {len(cabecera_zips)}")

    # --- Process Tipo 1: VENTAS.txt + ALICUOTAS.txt ---
    ventas_records = []
    ventas_alicuotas = {}  # (tipo_comp, pv, nro_hasta) → list of (alic_id, neto, iva)

    for zip_path in ventas_zips:
        logger.info(f"  [VENTAS] {zip_path.name}")
        with zipfile.ZipFile(zip_path) as zf:
            fname = _find_file(zf, "VENTAS.TXT")
            if not fname:
                continue
            content = _read_zip_file(zf, fname)
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
                ventas_records.append(record)

            alic_fname = _find_file(zf, "ALICUOTAS.TXT")
            if alic_fname:
                alic_content = _read_zip_file(zf, alic_fname)
                ventas_alicuotas.update(_parse_alicuotas_content(alic_content))

    logger.info(f"  {len(ventas_records)} facturas nuevas de VENTAS.txt")
    logger.info(f"  {len(ventas_alicuotas)} facturas con alicuotas en ALICUOTAS.txt")

    # --- Process Tipo 2: CABECERA.txt + DETALLE.txt ---
    cabecera_records = []
    all_detalle_raw = []  # list of (match_key, detalle_dict)

    for zip_path in cabecera_zips:
        logger.info(f"  [CABECERA] {zip_path.name}")
        with zipfile.ZipFile(zip_path) as zf:
            # Parse CABECERA.txt
            cab_fname = _find_file(zf, "CABECERA.TXT")
            if not cab_fname:
                continue
            cab_content = _read_zip_file(zf, cab_fname)
            zip_cab_records = []
            for line in cab_content.split("\n"):
                line = line.rstrip("\r")
                if not line:
                    continue
                record = _parse_cabecera_line(line)
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
                zip_cab_records.append(record)

            cabecera_records.extend(zip_cab_records)

            # Parse DETALLE.txt
            det_fname = _find_file(zf, "DETALLE.TXT")
            if not det_fname:
                logger.info(f"    No DETALLE.txt en {zip_path.name}")
                continue
            det_content = _read_zip_file(zf, det_fname)
            for line in det_content.split("\n"):
                line = line.rstrip("\r")
                if not line:
                    continue
                det = _parse_detalle_line(line)
                if not det:
                    continue
                match_key = (
                    det.pop("_tipo_comprobante"),
                    det.pop("_punto_venta"),
                    det.pop("_numero_desde"),
                )
                all_detalle_raw.append((match_key, det))

    logger.info(f"  {len(cabecera_records)} facturas nuevas de CABECERA.txt")
    logger.info(f"  {len(all_detalle_raw)} líneas de detalle parseadas")

    # --- Insert facturas ---
    total_facturas = 0

    # Insert VENTAS records (no returning needed)
    if ventas_records:
        total_facturas += batch_insert(conn, "factura_emitida", ventas_records)

        # Populate per-alicuota iva_* columns + imp_neto_gravado_total + total_iva
        # from ALICUOTAS.txt. This only applies to Tipo 1 (VENTAS.txt) facturas.
        if ventas_alicuotas:
            pv6_rows = fetch_all(
                conn,
                "SELECT id, tipo_comprobante, punto_venta, numero_hasta "
                "FROM factura_emitida WHERE punto_venta = 6"
            )
            id_map = {
                (int(r["tipo_comprobante"]), int(r["punto_venta"]), int(r["numero_hasta"])): r["id"]
                for r in pv6_rows
                if r["numero_hasta"] is not None
            }
            updates = []
            for r in ventas_records:
                akey = (r["tipo_comprobante"], r["punto_venta"], r["numero_hasta"])
                fid = id_map.get(akey)
                entries = ventas_alicuotas.get(akey)
                if fid is None or not entries:
                    continue
                row = {
                    "_id": fid,
                    "iva_0_neto": None,
                    "iva_2_5_neto": None, "iva_2_5": None,
                    "iva_10_5_neto": None, "iva_10_5": None,
                    "iva_21_neto": None, "iva_21": None,
                    "iva_27_neto": None, "iva_27": None,
                    "imp_neto_gravado_total": 0.0,
                    "total_iva": 0.0,
                }
                for alic_id, neto, iva in entries:
                    cols = ALICUOTA_FIELDS.get(alic_id)
                    if cols:
                        neto_col, iva_col = cols
                        row[neto_col] = neto
                        if iva_col:
                            row[iva_col] = iva
                    row["imp_neto_gravado_total"] += neto or 0.0
                    row["total_iva"] += iva or 0.0
                updates.append(row)

            if updates:
                with conn.cursor() as cur:
                    execute_batch(cur, """
                        UPDATE factura_emitida SET
                            iva_0_neto = %(iva_0_neto)s,
                            iva_2_5_neto = %(iva_2_5_neto)s,
                            iva_2_5 = %(iva_2_5)s,
                            iva_10_5_neto = %(iva_10_5_neto)s,
                            iva_10_5 = %(iva_10_5)s,
                            iva_21_neto = %(iva_21_neto)s,
                            iva_21 = %(iva_21)s,
                            iva_27_neto = %(iva_27_neto)s,
                            iva_27 = %(iva_27)s,
                            imp_neto_gravado_total = %(imp_neto_gravado_total)s,
                            total_iva = %(total_iva)s,
                            updated_at = NOW()
                        WHERE id = %(_id)s
                    """, updates)
                logger.info(f"  {len(updates)} facturas → IVA poblado desde ALICUOTAS.txt")

    # Insert CABECERA records with RETURNING to get IDs for detalle linking
    factura_id_map = {}  # (tipo_comp, pv, num_desde) → id
    if cabecera_records:
        inserted = batch_insert_returning(
            conn, "factura_emitida", cabecera_records,
            returning=["id", "tipo_comprobante", "punto_venta", "numero_desde"],
        )
        for row in inserted:
            fkey = (
                int(row["tipo_comprobante"]),
                int(row["punto_venta"]),
                int(row["numero_desde"]),
            )
            factura_id_map[fkey] = row["id"]
        total_facturas += len(inserted)

    logger.info(f"  {total_facturas} facturas insertadas en total")

    # --- Link and insert detalle ---
    # Also try to match detalle from CABECERA ZIPs whose parent factura
    # was already in the DB (not inserted this run). Query those IDs.
    if all_detalle_raw:
        # Collect unmatched keys
        unmatched_keys = set()
        for (tc, pv, nd), _ in all_detalle_raw:
            if (tc, pv, nd) not in factura_id_map:
                unmatched_keys.add((tc, pv, nd))

        # Batch-fetch existing factura IDs for unmatched keys
        if unmatched_keys:
            existing_facturas = fetch_all(
                conn,
                "SELECT id, tipo_comprobante, punto_venta, numero_desde "
                "FROM factura_emitida WHERE punto_venta = 6"
            )
            for row in existing_facturas:
                fkey = (
                    int(row["tipo_comprobante"]),
                    int(row["punto_venta"]),
                    int(row["numero_desde"]),
                )
                if fkey in unmatched_keys and fkey not in factura_id_map:
                    factura_id_map[fkey] = row["id"]

        # Build detalle records with factura_id
        detalle_records = []
        orphans = 0
        for (tc, pv, nd), det in all_detalle_raw:
            fid = factura_id_map.get((tc, pv, nd))
            if fid is None:
                orphans += 1
                continue
            det["factura_id"] = fid
            detalle_records.append(det)

        if orphans:
            logger.warning(f"  {orphans} líneas de detalle sin factura padre (huérfanas)")

        # Clear old detalle and insert fresh
        if detalle_records:
            delete_all(conn, "factura_emitida_detalle")
            det_count = batch_insert(conn, "factura_emitida_detalle", detalle_records)
            logger.info(f"  {det_count} líneas de detalle insertadas")

    return total_facturas

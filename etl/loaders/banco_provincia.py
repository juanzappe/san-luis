"""Loader: BANCO PROVINCIA → movimiento_bancario.

Fuente: data_raw/MOVIMIENTOS BANCARIOS/BANCO PROVINCIA/{year}/*.txt
Parse: Buscar línea "FECHA,CONCEPTO,IMPORTE,Fecha Valor,Saldo", leer CSV desde ahí.
Fijos: banco='provincia', cuenta='50080/7', cbu='0140191801520805008070', moneda='ARS'
"""

import csv
import io
from pathlib import Path

from utils import get_data_raw_path, parse_monto_argentino, parse_fecha_argentina, safe_str


def _parse_banco_txt(path: Path) -> list[dict]:
    """Parsea un TXT de extracto bancario Provincia."""
    records = []
    with open(path, "r", encoding="latin-1") as f:
        lines = f.readlines()

    # Buscar la línea de headers
    header_idx = None
    for i, line in enumerate(lines):
        if line.strip().startswith("FECHA,CONCEPTO,IMPORTE"):
            header_idx = i
            break

    if header_idx is None:
        return records

    # Parsear CSV desde header_idx
    csv_text = "".join(lines[header_idx:])
    reader = csv.DictReader(io.StringIO(csv_text))

    for row in reader:
        fecha = parse_fecha_argentina(row.get("FECHA", "").strip())
        concepto = safe_str(row.get("CONCEPTO"))
        importe_str = safe_str(row.get("IMPORTE"))
        saldo_str = safe_str(row.get("Saldo"))

        if not fecha:
            continue

        importe = parse_monto_argentino(importe_str)
        saldo = parse_monto_argentino(saldo_str)

        # Parsear Fecha Valor (DD-MM)
        fecha_valor_str = safe_str(row.get("Fecha Valor"))
        fecha_valor = None
        if fecha_valor_str and "-" in fecha_valor_str:
            parts = fecha_valor_str.split("-")
            if len(parts) == 2:
                # Tomar el año de la fecha principal
                year = fecha[:4]
                fecha_valor = f"{year}-{parts[1].zfill(2)}-{parts[0].zfill(2)}"

        rec = {
            "fecha": fecha,
            "banco": "provincia",
            "cuenta": "50080/7",
            "cbu": "0140191801520805008070",
            "moneda": "ARS",
            "concepto": concepto,
            "importe": importe,
            "fecha_valor": fecha_valor,
            "saldo": saldo,
        }

        # Determinar débito/crédito por signo
        if importe is not None:
            if importe >= 0:
                rec["credito"] = importe
            else:
                rec["debito"] = abs(importe)

        records.append(rec)

    return records


def run(sb, logger) -> int:
    data_dir = get_data_raw_path() / "MOVIMIENTOS BANCARIOS" / "BANCO PROVINCIA"
    txt_files = sorted(data_dir.rglob("*.txt"))
    logger.info(f"  {len(txt_files)} archivos TXT encontrados")

    all_records = []
    for txt_path in txt_files:
        logger.info(f"  Procesando {txt_path.name}")
        records = _parse_banco_txt(txt_path)
        all_records.extend(records)

    logger.info(f"  {len(all_records)} movimientos bancarios a cargar")

    # Delete + insert (composite dedup)
    sb.table("movimiento_bancario").delete().eq("banco", "provincia").execute()

    count = 0
    batch_size = 500
    for i in range(0, len(all_records), batch_size):
        batch = all_records[i:i + batch_size]
        sb.table("movimiento_bancario").insert(batch).execute()
        count += len(batch)

    return count

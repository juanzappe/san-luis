"""Loader: IMPUESTOS NACIONALES → pago_impuesto.

Fuente: data_raw/IMPUESTOS NACIONALES/impuestos_nacionales_*.csv
Parse: CSV con wrapping ="...", montos con $ prefix y formato argentino.
Row 1 = "CUIT: 30-65703377-0 - Fecha de emisión: 27/03/2026" (skip)
"""

import re
from utils import get_data_raw_path, parse_monto_argentino, parse_fecha_argentina, safe_str


def _clean_wrapped_value(val: str) -> str:
    """Quita wrapping ="..." de un valor."""
    v = val.strip()
    match = re.match(r'^="(.*)"$', v)
    return match.group(1) if match else v


def _parse_importe_impuesto(val: str) -> float | None:
    """Parsea importe con formato $ 2.800.000,00."""
    v = val.strip().replace("$", "").strip()
    return parse_monto_argentino(v)


def run(sb, logger) -> int:
    data_dir = get_data_raw_path() / "IMPUESTOS NACIONALES"
    csv_files = sorted(data_dir.glob("*.csv"))
    logger.info(f"  {len(csv_files)} archivos CSV encontrados")

    all_records = []

    for csv_path in csv_files:
        logger.info(f"  Procesando {csv_path.name}")

        with open(csv_path, "r", encoding="utf-8-sig") as f:
            lines = f.readlines()

        if len(lines) < 2:
            continue

        # Row 1 = header info (skip), Row 2 = column headers, Row 3+ = data
        headers_line = lines[1].strip()
        headers = [h.strip() for h in headers_line.split(",")]

        for line in lines[2:]:
            if not line.strip():
                continue

            # Split respetando comillas
            import csv as csv_mod
            import io
            reader = csv_mod.reader(io.StringIO(line))
            try:
                values = next(reader)
            except StopIteration:
                continue

            if len(values) < len(headers):
                continue

            row = {headers[i]: _clean_wrapped_value(values[i]) for i in range(len(headers))}

            fecha = parse_fecha_argentina(row.get("Fecha Operación", ""))
            if not fecha:
                continue

            impuesto_raw = safe_str(row.get("Impuesto"))
            periodo_raw = safe_str(row.get("Periodo"))
            observaciones_raw = safe_str(row.get("Observaciones"))

            # Combinar info en observaciones
            obs_parts = []
            if impuesto_raw:
                obs_parts.append(f"Impuesto: {impuesto_raw}")
            if periodo_raw:
                obs_parts.append(f"Período: {periodo_raw}")
            if observaciones_raw:
                obs_parts.append(observaciones_raw)

            all_records.append({
                "fecha_pago": fecha,
                "monto": _parse_importe_impuesto(row.get("Importe", "0")),
                "formulario": safe_str(row.get("Formulario")),
                "version": safe_str(row.get("Version")),
                "observaciones": " | ".join(obs_parts) if obs_parts else None,
            })

    logger.info(f"  {len(all_records)} pagos de impuestos a cargar")

    sb.table("pago_impuesto").delete().neq("id", 0).execute()
    count = 0
    batch_size = 500
    for i in range(0, len(all_records), batch_size):
        batch = all_records[i:i + batch_size]
        sb.table("pago_impuesto").insert(batch).execute()
        count += len(batch)

    return count

"""Loader: INVERSIONES → inversion + inversion_movimiento.

Fuente:
  Tenencias: data_raw/INVERSIONES/Tenencias-*.xlsx (metadata rows 1-9, headers row 10, data row 11+)
  Voucher:   data_raw/INVERSIONES/inviu-voucher-*.xlsx (metadata rows 1-6, headers row 7, data rows)
"""

from datetime import datetime
from pathlib import Path

import pandas as pd
from utils import (
    get_data_raw_path, safe_float, safe_str, parse_fecha_argentina,
    delete_all, batch_insert,
)


def _clean_moneda(val: str | None) -> str:
    """Return valid moneda_enum value, defaulting to ARS."""
    if not val or val.lower() == "nan":
        return "ARS"
    v = val.strip().upper()
    if v in ("ARS", "USD", "EUR"):
        return v
    return "ARS"


def _parse_tenencias(path: Path, logger) -> list[dict]:
    """Parsea tenencias del broker InvertirOnline."""
    wb = pd.ExcelFile(path)
    df_raw = pd.read_excel(wb, sheet_name=0, header=None, dtype=str)

    # Extraer fecha_valuacion de metadata (row 3 aprox: "Fecha de valuación: 27/03/2026")
    fecha_valuacion = None
    for i in range(min(10, len(df_raw))):
        val = safe_str(df_raw.iloc[i, 0])
        if val and "valuaci" in val.lower():
            fecha_str = safe_str(df_raw.iloc[i, 1])
            fecha_valuacion = parse_fecha_argentina(fecha_str)
            break

    # Leer con data_only para evitar fórmulas
    df = pd.read_excel(path, sheet_name=0, header=None)

    records = []
    current_tipo = None

    for i in range(len(df)):
        first_cell = safe_str(df.iloc[i, 0])
        if not first_cell:
            continue

        # Detectar secciones "Tipo de Activo: ..."
        if "tipo de activo:" in first_cell.lower():
            tipo_raw = first_cell.lower().replace("tipo de activo:", "").strip()
            if "moneda" in tipo_raw:
                current_tipo = "moneda"
            elif "bono" in tipo_raw:
                current_tipo = "bono"
            elif "acci" in tipo_raw:
                current_tipo = "accion"
            elif "fci" in tipo_raw:
                current_tipo = "fci"
            else:
                current_tipo = "otro"
            continue

        # Skip header rows and subtotals
        if first_cell.lower() in ("ticker", ""):
            continue
        if "subtotal" in first_cell.lower():
            continue

        # Check if this is a data row (column N has "Tipo de Activo" marker)
        col_n = safe_str(df.iloc[i, 13]) if df.shape[1] > 13 else None
        if col_n and "tipo de activo" in col_n.lower():
            marker = col_n.lower()
            if "moneda" in marker:
                row_tipo = "moneda"
            elif "bono" in marker:
                row_tipo = "bono"
            elif "acci" in marker:
                row_tipo = "accion"
            elif "fci" in marker:
                row_tipo = "fci"
            else:
                row_tipo = current_tipo or "otro"
        else:
            row_tipo = current_tipo

        ticker = safe_str(df.iloc[i, 0])
        nombre = safe_str(df.iloc[i, 1])
        if not ticker or not nombre:
            continue

        records.append({
            "broker": "invertironline",
            "cuenta_comitente": "243279",
            "ticker": ticker,
            "nombre": nombre,
            "tipo": row_tipo,
            "moneda": _clean_moneda(safe_str(df.iloc[i, 5])),
            "cantidad": safe_float(df.iloc[i, 2]),
            "garantia": safe_float(df.iloc[i, 3]),
            "disponibles": safe_float(df.iloc[i, 4]),
            "valuacion_precio": safe_float(df.iloc[i, 6]),
            "valuacion_monto": safe_float(df.iloc[i, 7]),
            "valuacion_usd": safe_float(df.iloc[i, 8]),
            "precio_compra": safe_float(df.iloc[i, 9]),
            "costo_total": safe_float(df.iloc[i, 10]),
            "resultado": safe_float(df.iloc[i, 11]),
            "variacion_pct": safe_float(df.iloc[i, 12]),
            "fecha_valuacion": fecha_valuacion,
        })

    return records


def _parse_voucher(path: Path, logger) -> list[dict]:
    """Parsea voucher de movimientos del broker."""
    df = pd.read_excel(path, sheet_name=0, header=None)

    records = []
    current_moneda = "ARS"

    for i in range(len(df)):
        first_cell = safe_str(df.iloc[i, 0])
        if not first_cell:
            continue

        # Detectar sección de moneda
        if "pesos" in first_cell.lower() and "$" in first_cell:
            current_moneda = "ARS"
            continue
        if "dolar" in first_cell.lower() and "usd" in first_cell.lower():
            current_moneda = "USD"
            continue

        # Skip headers and metadata
        if first_cell.lower() in ("fecha de concertación", "reporte", "busqueda", "rango",
                                   "cuenta corriente", "disponible"):
            continue
        if "comitente" in first_cell.lower() or "cliente" in first_cell.lower():
            continue

        # Try to parse as data row (fecha in first column)
        fecha_conc = None
        if isinstance(df.iloc[i, 0], datetime):
            fecha_conc = df.iloc[i, 0].strftime("%Y-%m-%d")
        elif "/" in str(first_cell):
            fecha_conc = parse_fecha_argentina(first_cell)

        if not fecha_conc:
            continue

        fecha_liq = None
        if isinstance(df.iloc[i, 1], datetime):
            fecha_liq = df.iloc[i, 1].strftime("%Y-%m-%d")
        else:
            fecha_liq = parse_fecha_argentina(safe_str(df.iloc[i, 1]))

        records.append({
            "fecha_concertacion": fecha_conc,
            "fecha_liquidacion": fecha_liq,
            "descripcion": safe_str(df.iloc[i, 2]),
            "tipo_operacion": safe_str(df.iloc[i, 3]),
            "ticker": safe_str(df.iloc[i, 4]),
            "cantidad_vn": safe_float(df.iloc[i, 5]),
            "precio": safe_float(df.iloc[i, 6]),
            "importe_bruto": safe_float(df.iloc[i, 7]),
            "importe_neto": safe_float(df.iloc[i, 8]),
            "saldo": safe_float(df.iloc[i, 9]),
            "moneda": current_moneda,
            "seccion": current_moneda,
        })

    return records


def run(conn, logger) -> int:
    data_dir = get_data_raw_path() / "INVERSIONES"

    total = 0

    # Procesar tenencias
    tenencias_files = sorted(data_dir.glob("Tenencias-*.xlsx"))
    if tenencias_files:
        delete_all(conn, "inversion")
        all_tenencias = []
        for f in tenencias_files:
            logger.info(f"  Procesando tenencias: {f.name}")
            records = _parse_tenencias(f, logger)
            logger.info(f"  {len(records)} posiciones de inversión")
            all_tenencias.extend(records)
        total += batch_insert(conn, "inversion", all_tenencias)

    # Procesar voucher
    voucher_files = sorted(data_dir.glob("inviu-voucher-*.xlsx"))
    if voucher_files:
        delete_all(conn, "inversion_movimiento")
        all_voucher = []
        for f in voucher_files:
            logger.info(f"  Procesando voucher: {f.name}")
            records = _parse_voucher(f, logger)
            logger.info(f"  {len(records)} movimientos de inversión")
            all_voucher.extend(records)
        total += batch_insert(conn, "inversion_movimiento", all_voucher)

    return total

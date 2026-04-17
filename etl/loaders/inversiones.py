"""Loader: INVERSIONES → inversion + inversion_movimiento.

Fuente:
  Tenencias:    data_raw/INVERSIONES/Tenencias-*.xlsx
                Filas 1-7: metadata (fecha valuación, TC MEP, TC CCL)
                Secciones separadas por header "Tipo de Activo: <tipo>"
                Columnas: Ticker(0), Nombre(1), Cantidad[fórmula](2), Garantía(3),
                          Disponibles(4), Moneda(5), Precio actual(6), Monto$(7)[fórmula],
                          Equiv U$S(8)[fórmula], Costo/PPC(9), Monto invertido(10)[fórmula],
                          Resultado(11)[fórmula], Var%(12)[fórmula], MTM Acumulado(13)
                IMPORTANTE: Cantidad tiene fórmulas → usar Disponibles(col 4).
                            Monto/Resultado/Var% también tienen fórmulas → recalcular en Python.

  Movimientos:  data_raw/INVERSIONES/inviu-movimientos-*.xlsx
                Header: Operación, Concertación, Liquidación, Descripción,
                        Monto, Cantidad, Precio, Moneda
                Sin fórmulas, lectura directa por nombre de columna.
"""

from pathlib import Path

import pandas as pd

from utils import (
    get_data_raw_path, safe_float, safe_str, parse_fecha_argentina,
    delete_all, batch_insert,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean_str(val) -> str | None:
    """Like safe_str but also rejects the string 'nan' (producto de NaN en pandas)."""
    s = safe_str(val)
    if s is None or s.lower() == "nan":
        return None
    return s


def _clean_moneda(val: str | None) -> str:
    """Normaliza a moneda_enum válido, default ARS."""
    if not val:
        return "ARS"
    v = val.strip().upper()
    return v if v in ("ARS", "USD", "EUR") else "ARS"


def _parse_fecha_cell(val) -> str | None:
    """Parsea fecha desde celda Excel (datetime o string DD/MM/YYYY)."""
    if val is None:
        return None
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m-%d")
    return parse_fecha_argentina(safe_str(val))


# ---------------------------------------------------------------------------
# Tenencias
# ---------------------------------------------------------------------------

def _parse_tenencias(path: Path, logger) -> list[dict]:
    """Parsea tenencias del broker Inviu/InvertirOnline.

    Extrae TC MEP y TC CCL de las filas de metadata (filas 1-7).
    Usa Disponibles (col 4) como cantidad real — Cantidad (col 2) tiene fórmulas.
    Recalcula monto ARS, USD, costo total, resultado y var% en Python.
    """
    # --- Leer una sola vez, sin dtype forzado ---
    df = pd.read_excel(path, sheet_name=0, header=None)

    fecha_valuacion = None
    tc_mep = 0.0
    tc_ccl = 0.0

    for i in range(min(10, len(df))):
        cell0 = _clean_str(df.iloc[i, 0]) or ""
        cell1 = _clean_str(df.iloc[i, 1]) if df.shape[1] > 1 else None
        cell0_lower = cell0.lower()

        if "valuaci" in cell0_lower:
            fecha_valuacion = parse_fecha_argentina(cell1)
        elif "mep" in cell0_lower:
            # TC values are formatted as plain floats ("1427.4"), not Argentine format.
            # Using safe_float would strip the dot as a thousands separator → wrong value.
            try:
                tc_mep = float(cell1) if cell1 else 0.0
            except (ValueError, TypeError):
                tc_mep = 0.0
        elif "ccl" in cell0_lower:
            try:
                tc_ccl = float(cell1) if cell1 else 0.0
            except (ValueError, TypeError):
                tc_ccl = 0.0

    if tc_mep <= 0:
        logger.warning("  TC MEP no encontrado en metadata — los montos USD no se convertirán correctamente")
        tc_mep = 1.0
    if tc_ccl <= 0:
        tc_ccl = tc_mep  # fallback

    logger.info(f"  TC MEP={tc_mep:.2f}  TC CCL={tc_ccl:.2f}  Fecha={fecha_valuacion}")

    records = []
    current_tipo: str | None = None

    for i in range(len(df)):
        first_cell = _clean_str(df.iloc[i, 0])
        if not first_cell:
            continue

        # Detectar sección "Tipo de Activo: ..."
        fc_lower = first_cell.lower()
        if "tipo de activo:" in fc_lower:
            tipo_raw = fc_lower.replace("tipo de activo:", "").strip()
            if "moneda" in tipo_raw:
                current_tipo = "moneda"
            elif "bono" in tipo_raw:
                current_tipo = "bono"
            elif "cedear" in tipo_raw:
                current_tipo = "cedear"
            elif "acci" in tipo_raw:
                current_tipo = "accion"
            elif "fci" in tipo_raw:
                current_tipo = "fci"
            else:
                current_tipo = "otro"
            continue

        # Skip rows before the first "Tipo de Activo:" section (metadata header rows)
        if current_tipo is None:
            continue

        # Saltar headers y subtotales
        if fc_lower in ("ticker",) or "subtotal" in fc_lower or "total" == fc_lower:
            continue

        ticker = _clean_str(df.iloc[i, 0])
        nombre = _clean_str(df.iloc[i, 1])
        if not ticker or not nombre:
            continue

        # Skip subtotal rows (text may be in nombre column, not ticker)
        if "subtotal" in nombre.lower():
            continue

        # Columnas de referencia (sin fórmulas)
        moneda = _clean_moneda(_clean_str(df.iloc[i, 5]) if df.shape[1] > 5 else None)
        disponibles  = safe_float(df.iloc[i, 4]) or 0.0   # col 4: Disponibles (real)
        garantia     = safe_float(df.iloc[i, 3]) or 0.0   # col 3: Garantía
        precio_actual = safe_float(df.iloc[i, 6]) or 0.0  # col 6: Precio actual
        precio_compra = safe_float(df.iloc[i, 9]) or 0.0  # col 9: Costo (PPC)

        # Recalcular campos que el Excel calcula con fórmulas
        if moneda == "USD":
            valuacion_monto = disponibles * precio_actual * tc_mep
            costo_total     = disponibles * precio_compra * tc_mep
        else:
            valuacion_monto = disponibles * precio_actual
            costo_total     = disponibles * precio_compra

        valuacion_usd = valuacion_monto / tc_mep if tc_mep > 0 else 0.0
        resultado     = valuacion_monto - costo_total
        variacion_pct = (resultado / costo_total * 100) if costo_total > 0 else 0.0

        records.append({
            "broker":           "invertironline",
            "cuenta_comitente": "243279",
            "ticker":           ticker,
            "nombre":           nombre,
            "tipo":             current_tipo or "otro",
            "moneda":           moneda,
            "cantidad":         disponibles,
            "garantia":         garantia,
            "disponibles":      disponibles,
            "valuacion_precio": precio_actual,
            "valuacion_monto":  round(valuacion_monto, 2),
            "valuacion_usd":    round(valuacion_usd, 2),
            "precio_compra":    precio_compra,
            "costo_total":      round(costo_total, 2),
            "resultado":        round(resultado, 2),
            "variacion_pct":    round(variacion_pct, 4),
            "fecha_valuacion":  fecha_valuacion,
        })

    return records


# ---------------------------------------------------------------------------
# Movimientos
# ---------------------------------------------------------------------------

def _parse_movimientos(path: Path, logger) -> list[dict]:
    """Parsea movimientos Inviu: Operación, Concertación, Liquidación, Descripción,
    Monto, Cantidad, Precio, Moneda. Lectura directa por nombre de columna."""
    df = pd.read_excel(path, sheet_name=0, header=0)
    df.columns = [str(c).strip().lower() for c in df.columns]

    col_op   = next((c for c in df.columns if "operaci" in c), None)
    col_conc = next((c for c in df.columns if "concertaci" in c), None)
    col_liq  = next((c for c in df.columns if "liquidaci" in c), None)
    col_desc = next((c for c in df.columns if "descrip" in c), None)
    col_mon  = next((c for c in df.columns if "monto" in c), None)
    col_cant = next((c for c in df.columns if "cantidad" in c), None)
    col_prec = next((c for c in df.columns if "precio" in c), None)
    col_mnd  = next((c for c in df.columns if "moneda" in c), None)

    records = []
    for _, row in df.iterrows():
        fecha_conc = _parse_fecha_cell(row[col_conc]) if col_conc else None
        fecha_liq  = _parse_fecha_cell(row[col_liq])  if col_liq  else None

        if not fecha_conc and not fecha_liq:
            continue

        records.append({
            "fecha_concertacion": fecha_conc,
            "fecha_liquidacion":  fecha_liq or fecha_conc,
            "descripcion":        _clean_str(row[col_desc]) if col_desc else None,
            "tipo_operacion":     _clean_str(row[col_op])   if col_op   else None,
            "ticker":             None,
            "cantidad_vn":        safe_float(row[col_cant]) if col_cant else None,
            "precio":             safe_float(row[col_prec]) if col_prec else None,
            "importe_bruto":      None,
            "importe_neto":       safe_float(row[col_mon])  if col_mon  else None,
            "saldo":              None,
            "moneda":             _clean_moneda(_clean_str(row[col_mnd]) if col_mnd else None),
            "seccion":            None,
        })

    return records


# ---------------------------------------------------------------------------
# run()
# ---------------------------------------------------------------------------

def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "INVERSIONES"
    total = 0

    # --- Tenencias ---
    tenencias_files = sorted(data_dir.glob("Tenencias-*.xlsx"))
    if tenencias_files:
        delete_all(conn, "inversion")
        all_tenencias = []
        for f in tenencias_files:
            logger.info(f"  Procesando tenencias: {f.name}")
            records = _parse_tenencias(f, logger)
            logger.info(f"  {len(records)} posiciones")
            all_tenencias.extend(records)
        total += batch_insert(conn, "inversion", all_tenencias)

    # --- Movimientos ---
    # Soporta nombre nuevo (inviu-movimientos-*.xlsx) y anterior (inviu-voucher-*.xlsx)
    mov_files = sorted(data_dir.glob("inviu-movimientos-*.xlsx")) or \
                sorted(data_dir.glob("inviu-voucher-*.xlsx"))
    if mov_files:
        delete_all(conn, "inversion_movimiento")
        all_mov = []
        for f in mov_files:
            logger.info(f"  Procesando movimientos: {f.name}")
            records = _parse_movimientos(f, logger)
            logger.info(f"  {len(records)} movimientos")
            all_mov.extend(records)
        total += batch_insert(conn, "inversion_movimiento", all_mov)

    return total

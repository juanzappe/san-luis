"""Loader: EECC → balance_rubro + estado_resultados_contable.

Fuente: data_raw/EECC/ANALISIS EECC.xlsx
Sheets útiles: "ESP $" (balance) y "ER $" (estado de resultados)
Lógica: Unpivot de columnas-año a filas.
"""

import pandas as pd
from utils import get_data_raw_path, safe_float, safe_str, delete_all, batch_insert


# Mapeo de rubros del balance a secciones
SECCION_BALANCE_MAP = {
    "activo corriente": "activo_corriente",
    "activo no corriente": "activo_no_corriente",
    "pasivo corriente": "pasivo_corriente",
    "pasivo no corriente": "pasivo_no_corriente",
    "patrimonio neto": "patrimonio_neto",
}

# Mapeo de líneas del EERR a secciones
SECCION_EERR_MAP = {
    "ingresos por ventas": "ingresos",
    "costos operativos": "costo_operativo",
    "resultado bruto": "ingresos",
    "gastos de administra": "gasto_administracion",
    "gastos de comercializ": "gasto_comercializacion",
    "resultado operativo": "resultado",
    "gastos financ": "gasto_financiero",
    "otros ingresos": "otros_ingresos",
    "impuesto a las ganancias": "impuestos",
    "resultado ordinario": "resultado",
    "resultado integral": "resultado",
    "resultado por accion": "resultado",
    "cantidad acciones": "resultado",
    "resultado del ejercicio": "resultado",
}

EJERCICIOS = [
    ("31.12.2021", "2021", "2021-12-31"),
    ("31.12.2022", "2022", "2022-12-31"),
    ("31.12.2023", "2023", "2023-12-31"),
    ("31.12.2024", "2024", "2024-12-31"),
]


def _parse_esp(path: str, logger) -> list[dict]:
    """Parsea ESP $ (Estado de Situación Patrimonial / Balance)."""
    df = pd.read_excel(path, sheet_name="ESP $", header=None)
    logger.info(f"  ESP $: {len(df)} filas")

    records = []
    current_seccion = None
    orden = 0

    for i in range(5, len(df)):
        label = safe_str(df.iloc[i, 1])
        if not label:
            continue

        label_lower = label.lower().strip()

        for key, seccion in SECCION_BALANCE_MAP.items():
            if key in label_lower:
                current_seccion = seccion
                break

        if label_lower in ("activo", "pasivo"):
            continue
        if "total" in label_lower and "activo" not in label_lower and "pasivo" not in label_lower:
            pass

        if not current_seccion:
            continue

        for col_idx, (_, ejercicio, fecha_cierre) in enumerate(EJERCICIOS):
            monto = safe_float(df.iloc[i, 2 + col_idx])
            if monto is None:
                continue

            orden += 1
            is_sub = label.startswith(" ") or label.startswith("\t")
            rubro = label.strip()
            subrubro = None
            if is_sub and "(" in rubro:
                subrubro = rubro

            records.append({
                "ejercicio": ejercicio,
                "fecha_cierre": fecha_cierre,
                "seccion": current_seccion,
                "rubro": rubro,
                "subrubro": subrubro,
                "monto": monto,
                "orden": orden,
            })

    return records


def _parse_er(path: str, logger) -> list[dict]:
    """Parsea ER $ (Estado de Resultados)."""
    df = pd.read_excel(path, sheet_name="ER $", header=None)
    logger.info(f"  ER $: {len(df)} filas")

    records = []
    orden = 0

    for i in range(5, len(df)):
        label = safe_str(df.iloc[i, 1])
        if not label:
            continue

        label_lower = label.lower().strip()

        seccion = "resultado"
        for key, sec in SECCION_EERR_MAP.items():
            if key in label_lower:
                seccion = sec
                break

        for col_idx, (_, ejercicio, fecha_cierre) in enumerate(EJERCICIOS):
            monto = safe_float(df.iloc[i, 2 + col_idx])
            if monto is None:
                continue

            orden += 1
            records.append({
                "ejercicio": ejercicio,
                "fecha_cierre": fecha_cierre,
                "linea": label.strip(),
                "seccion": seccion,
                "monto": monto,
                "orden": orden,
            })

    return records


def run(conn, logger, full: bool = False) -> int:
    path = get_data_raw_path() / "EECC" / "ANALISIS EECC.xlsx"
    logger.info(f"  Leyendo {path}")

    total = 0

    # Balance (ESP $)
    balance_records = _parse_esp(str(path), logger)
    logger.info(f"  {len(balance_records)} rubros de balance a cargar")
    delete_all(conn, "balance_rubro")
    total += batch_insert(conn, "balance_rubro", balance_records)

    # Estado de Resultados (ER $)
    er_records = _parse_er(str(path), logger)
    logger.info(f"  {len(er_records)} líneas de EERR a cargar")
    delete_all(conn, "estado_resultados_contable")
    total += batch_insert(conn, "estado_resultados_contable", er_records)

    return total

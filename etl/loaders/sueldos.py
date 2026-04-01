"""Loader: SUELDOS → empleado + liquidacion_sueldo.

Fuente: data_raw/SUELDOS/{year}/*.xlsx
Row 1 = título ("Detalle de transferencias"), Row 2 = headers, datos desde Row 3.
Side effect: upsert empleados por nombre.
Período: derivado del nombre del archivo (SUELDOS_FEBRERO_2026 → "2026-02")

Modo incremental (default): solo carga períodos > max(periodo) existente.
Modo full (--full): borra todo y recarga.
"""

import re
from datetime import datetime
from pathlib import Path

import pandas as pd
from utils import (
    get_data_raw_path, safe_float, safe_str,
    delete_all, batch_insert, batch_insert_returning, fetch_all,
    get_max_value,
)


MESES = {
    "AGUINALDO_JUNIO": "06-SAC", "AGUINALDO_DICIEMBRE": "12-SAC",
    "ENERO": "01", "FEBRERO": "02", "MARZO": "03", "ABRIL": "04",
    "MAYO": "05", "JUNIO": "06", "JULIO": "07", "AGOSTO": "08",
    "SEPTIEMBRE": "09", "OCTUBRE": "10", "NOVIEMBRE": "11", "DICIEMBRE": "12",
}


def _extract_periodo(filename: str) -> str:
    """Extrae período del nombre de archivo. Ej: SUELDOS_FEBRERO_2024.xlsx → 2024-02"""
    name = re.sub(r" \(\d+\)", "", filename.upper().replace(".XLSX", ""))

    # Buscar año (4 dígitos)
    year_match = re.search(r"(\d{4})", name)
    year = year_match.group(1) if year_match else "0000"

    # Buscar mes
    for mes_key, mes_val in MESES.items():
        if mes_key in name:
            return f"{year}-{mes_val}"

    return year


def _parse_fecha_sueldo(val) -> str | None:
    """Parsea fecha de transferencia (03-may-2024) a YYYY-MM-DD."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    # Meses en español abreviados
    meses_es = {
        "ene": "01", "feb": "02", "mar": "03", "abr": "04",
        "may": "05", "jun": "06", "jul": "07", "ago": "08",
        "sep": "09", "oct": "10", "nov": "11", "dic": "12",
    }
    match = re.match(r"(\d{1,2})-(\w{3})-(\d{4})", s.lower())
    if match:
        day = match.group(1).zfill(2)
        month = meses_es.get(match.group(2), "01")
        year = match.group(3)
        return f"{year}-{month}-{day}"
    return None


def run(conn, logger, full: bool = False) -> int:
    data_dir = get_data_raw_path() / "SUELDOS"
    xlsx_files = sorted(data_dir.rglob("*.xlsx"))
    logger.info(f"  {len(xlsx_files)} archivos XLSX encontrados")

    if full:
        logger.info("  Modo FULL RELOAD: borrando datos existentes")
        max_periodo = None
    else:
        max_periodo = get_max_value(conn, "liquidacion_sueldo", "periodo")
        if max_periodo:
            logger.info(f"  Modo incremental: solo periodo > {max_periodo}")
        else:
            logger.info("  Tabla vacía, cargando todo")

    # cuil → { nombre (longest without "000"), cuenta_bancaria }
    empleados_map: dict[str, dict] = {}
    all_liquidaciones = []
    skipped_files = 0

    for xlsx_path in xlsx_files:
        periodo = _extract_periodo(xlsx_path.name)

        # Incremental: skip files for already-loaded periods
        if max_periodo and periodo <= max_periodo:
            skipped_files += 1
            continue

        logger.info(f"  Procesando {xlsx_path.name} (periodo: {periodo})")

        try:
            df = pd.read_excel(xlsx_path, header=1)  # header en row 2 (index 1)
        except Exception as e:
            logger.warning(f"  No se pudo leer {xlsx_path.name}: {e}")
            continue

        for _, row in df.iterrows():
            nombre = safe_str(row.get("Nombre Beneficiario"))
            cuenta = safe_str(row.get("Cuenta Beneficiario"))
            cuil = safe_str(row.get("Referencia"))
            if not nombre:
                continue
            if not cuil:
                cuil = nombre

            # Keep the longest name without "000" as canonical
            existing = empleados_map.get(cuil)
            if existing is None:
                empleados_map[cuil] = {"nombre": nombre, "cuenta_bancaria": cuenta, "cuil": cuil if cuil != nombre else None}
            else:
                has_000 = "000" in nombre
                existing_has_000 = "000" in existing["nombre"]
                if (existing_has_000 and not has_000) or (
                    existing_has_000 == has_000 and len(nombre) > len(existing["nombre"])
                ):
                    existing["nombre"] = nombre
                if cuenta:
                    existing["cuenta_bancaria"] = cuenta

            all_liquidaciones.append({
                "cuil": cuil,
                "periodo": periodo,
                "sueldo_neto": safe_float(row.get("Importe")),
                "fecha_transferencia": _parse_fecha_sueldo(row.get("Fecha")),
                "cuenta_beneficiario": cuenta,
                "situacion_transferencia": safe_str(row.get("Situación")),
                "fuente": "transferencia",
            })

    if skipped_files:
        logger.info(f"  {skipped_files} archivos saltados (período ya cargado)")

    if not all_liquidaciones:
        logger.info("  Sin liquidaciones nuevas para cargar")
        return 0

    if full:
        delete_all(conn, "liquidacion_sueldo")
        delete_all(conn, "empleado")

        # Full: insert all employees fresh
        empleados_data = list(empleados_map.values())
        emp_id_map = {}
        rows = batch_insert_returning(conn, "empleado", empleados_data,
                                       returning=["id", "cuil"])
        for row in rows:
            emp_id_map[row["cuil"]] = row["id"]
    else:
        # Incremental: get existing employees, upsert new ones
        existing_emps = fetch_all(conn, "SELECT id, cuil FROM empleado")
        emp_id_map = {row["cuil"]: row["id"] for row in existing_emps}

        # Find employees in new data that don't exist yet
        new_empleados = [
            emp for cuil, emp in empleados_map.items()
            if cuil not in emp_id_map
        ]
        if new_empleados:
            logger.info(f"  {len(new_empleados)} empleados nuevos a insertar")
            new_rows = batch_insert_returning(conn, "empleado", new_empleados,
                                               returning=["id", "cuil"])
            for row in new_rows:
                emp_id_map[row["cuil"]] = row["id"]

    # Insert liquidaciones
    liq_records = []
    for liq in all_liquidaciones:
        emp_id = emp_id_map.get(liq["cuil"])
        if not emp_id:
            continue
        liq_records.append({
            "empleado_id": emp_id,
            "periodo": liq["periodo"],
            "sueldo_neto": liq["sueldo_neto"],
            "fecha_transferencia": liq["fecha_transferencia"],
            "cuenta_beneficiario": liq["cuenta_beneficiario"],
            "situacion_transferencia": liq["situacion_transferencia"],
            "fuente": liq["fuente"],
        })

    count = batch_insert(conn, "liquidacion_sueldo", liq_records)
    logger.info(f"  {len(empleados_map)} empleados procesados, {count} liquidaciones nuevas")
    return count

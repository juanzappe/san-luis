"""Utilidades compartidas para el pipeline ETL de San Luis."""

import math
import os
import re
import logging
from datetime import datetime, date
from pathlib import Path

import pandas as pd
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Conexión PostgreSQL (directo a Supabase via connection string)
# ---------------------------------------------------------------------------

def get_db_connection():
    """Crea y retorna una conexión psycopg2 usando DATABASE_URL."""
    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    conn.autocommit = True
    return conn


def get_data_raw_path() -> Path:
    """Retorna la ruta a data_raw/."""
    return Path(os.environ.get("DATA_RAW_PATH", "../data_raw"))


# ---------------------------------------------------------------------------
# Operaciones SQL batch
# ---------------------------------------------------------------------------

def _safe_id(name: str) -> str:
    """Validates a SQL identifier (table/column name). Only a-z, 0-9, _ allowed."""
    if not re.match(r'^[a-z][a-z0-9_]*$', name):
        raise ValueError(f"Identificador SQL inválido: {name!r}")
    return name


def delete_all(conn, tabla: str):
    """DELETE FROM tabla (todas las filas)."""
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {_safe_id(tabla)}")


def delete_where(conn, tabla: str, campo: str, valor):
    """DELETE FROM tabla WHERE campo = valor."""
    with conn.cursor() as cur:
        cur.execute(f"DELETE FROM {_safe_id(tabla)} WHERE {_safe_id(campo)} = %s", (valor,))


def batch_insert(conn, tabla: str, datos: list[dict],
                 batch_size: int = 500) -> int:
    """Insert en batches usando execute_values. Retorna total insertado."""
    if not datos:
        return 0
    cols = list(datos[0].keys())
    cols_sql = ", ".join(_safe_id(c) for c in cols)
    template = "(" + ", ".join([f"%({c})s" for c in cols]) + ")"
    sql = f"INSERT INTO {_safe_id(tabla)} ({cols_sql}) VALUES %s"

    total = 0
    with conn.cursor() as cur:
        for i in range(0, len(datos), batch_size):
            batch = datos[i:i + batch_size]
            psycopg2.extras.execute_values(
                cur, sql, batch, template=template, page_size=batch_size
            )
            total += len(batch)
    return total


def batch_insert_returning(conn, tabla: str, datos: list[dict],
                           returning: list[str],
                           batch_size: int = 500) -> list[dict]:
    """Insert en batches y retorna las columnas solicitadas (RETURNING).

    Usa execute_values con RETURNING para un único round-trip por batch.
    """
    if not datos:
        return []
    cols = list(datos[0].keys())
    cols_sql = ", ".join(_safe_id(c) for c in cols)
    template = "(" + ", ".join([f"%({c})s" for c in cols]) + ")"
    returning_sql = ", ".join(_safe_id(c) for c in returning)
    sql = f"INSERT INTO {_safe_id(tabla)} ({cols_sql}) VALUES %s RETURNING {returning_sql}"

    all_rows = []
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        for i in range(0, len(datos), batch_size):
            batch = datos[i:i + batch_size]
            psycopg2.extras.execute_values(cur, sql, batch, template=template, page_size=batch_size)
            all_rows.extend(dict(row) for row in cur.fetchall())
    return all_rows


def batch_upsert(conn, tabla: str, datos: list[dict],
                 on_conflict: str, batch_size: int = 500) -> int:
    """Upsert en batches con ON CONFLICT DO UPDATE. Retorna total procesado."""
    if not datos:
        return 0
    cols = list(datos[0].keys())
    cols_sql = ", ".join(_safe_id(c) for c in cols)
    template = "(" + ", ".join([f"%({c})s" for c in cols]) + ")"
    update_cols = [c for c in cols if c != on_conflict]
    update_sql = ", ".join([f"{_safe_id(c)} = EXCLUDED.{_safe_id(c)}" for c in update_cols])
    sql = (
        f"INSERT INTO {_safe_id(tabla)} ({cols_sql}) VALUES %s "
        f"ON CONFLICT ({_safe_id(on_conflict)}) DO UPDATE SET {update_sql}"
    )

    total = 0
    with conn.cursor() as cur:
        for i in range(0, len(datos), batch_size):
            batch = datos[i:i + batch_size]
            psycopg2.extras.execute_values(
                cur, sql, batch, template=template, page_size=batch_size
            )
            total += len(batch)
    return total


def fetch_all(conn, sql: str, params=None) -> list[dict]:
    """Ejecuta un SELECT y retorna lista de dicts."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        return [dict(row) for row in cur.fetchall()]


def get_max_value(conn, tabla: str, columna: str) -> str | None:
    """Retorna MAX(columna) de la tabla, o None si está vacía.

    Sirve para determinar hasta dónde se cargó en modo incremental.
    """
    with conn.cursor() as cur:
        cur.execute(f"SELECT MAX({_safe_id(columna)})::text FROM {_safe_id(tabla)}")
        row = cur.fetchone()
        return row[0] if row and row[0] else None


# ---------------------------------------------------------------------------
# Parseo de formatos argentinos
# ---------------------------------------------------------------------------

def parse_monto_argentino(texto: str) -> float | None:
    """Parsea un monto en formato argentino (1.234.567,89) a float.

    Regla: quitar puntos PRIMERO, luego reemplazar coma por punto.
    """
    if texto is None or (isinstance(texto, str) and texto.strip() == ""):
        return None
    if isinstance(texto, (int, float)):
        return float(texto)
    t = str(texto).strip()
    # Quitar prefijo $ y espacios
    t = t.replace("$", "").strip()
    # Quitar puntos de miles PRIMERO
    t = t.replace(".", "")
    # Coma decimal → punto
    t = t.replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


def parse_fecha_argentina(texto: str) -> str | None:
    """Parsea DD/MM/YYYY → YYYY-MM-DD string."""
    if texto is None:
        return None
    t = str(texto).strip()
    if not t:
        return None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(t, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    # Intentar ISO ya parseada
    if re.match(r"\d{4}-\d{2}-\d{2}", t):
        return t[:10]
    return None


def parse_fecha_datetime(texto) -> str | None:
    """Parsea datetime de Excel o string variados a YYYY-MM-DD."""
    if texto is None:
        return None
    if isinstance(texto, (datetime, date)):
        return texto.strftime("%Y-%m-%d")
    return parse_fecha_argentina(str(texto))


def safe_int(val) -> int | None:
    """Convierte a int de forma segura."""
    if val is None:
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def safe_float(val) -> float | None:
    """Convierte a float de forma segura. Rechaza NaN de pandas."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        if math.isnan(val):
            return None
        return float(val)
    return parse_monto_argentino(str(val))


def safe_str(val) -> str | None:
    """Convierte a string limpio o None."""
    if val is None:
        return None
    s = str(val).strip()
    return s if s else None


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

def clean_arca_csv(path: str | Path) -> pd.DataFrame:
    """Lee un CSV de ARCA (UTF-8 BOM, separador ;, montos argentinos)."""
    df = pd.read_csv(
        path,
        sep=";",
        encoding="utf-8-sig",
        dtype=str,
        keep_default_na=False,
    )
    # Limpiar nombres de columnas (strip BOM residual y espacios)
    df.columns = [c.strip().strip("\ufeff") for c in df.columns]
    return df


def clean_wrapped_csv(path: str | Path) -> pd.DataFrame:
    """Lee un CSV con wrapping ="..." (impuestos nacionales)."""
    df = pd.read_csv(
        path,
        encoding="utf-8-sig",
        dtype=str,
        keep_default_na=False,
        skiprows=1,  # Skip CUIT header line
    )
    # Quitar wrapping ="..." de todos los valores
    for col in df.columns:
        df[col] = df[col].apply(lambda x: re.sub(r'^="(.*)"$', r"\1", str(x).strip()))
    df.columns = [re.sub(r'^="(.*)"$', r"\1", c.strip()) for c in df.columns]
    return df


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    """Configura logging estándar para el ETL."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    return logging.getLogger("etl")
